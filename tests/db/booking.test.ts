import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { confirm, createDb, createDoctor, createUser, gridSlotAfter, holdAs, rpc, tehranAt } from './harness';

let db: PGlite;
beforeAll(async () => { db = await createDb(); });

const booking = async (id: string) =>
  (await db.query<Record<string, unknown>>('select * from bookings where id = $1', [id])).rows[0]!;
const jobs = async (prefix: string) =>
  (await db.query<{ idempotency_key: string }>(`select idempotency_key from jobs where idempotency_key like $1 order by 1`, [prefix + '%'])).rows.map(r => r.idempotency_key);

describe('hold_slot', () => {
  it('holds a grid slot with price, share and policy snapshot', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    const id = await holdAs(db, client, doctor, tehranAt(3, 21));
    const b = await booking(id);
    expect(b.booking_status).toBe('held');
    expect(b.price_cents).toBe(5000);
    expect(b.doctor_share_cents).toBe(3500);
    expect(b.policy_version_id).toBeTruthy();
    const mins = ((b.hold_expires_at as Date).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(29);
    expect(mins).toBeLessThanOrEqual(30);
  });

  it('second client on the same slot gets slot_taken', async () => {
    const doctor = await createDoctor(db);
    await holdAs(db, await createUser(db), doctor, tehranAt(3, 21));
    await expect(holdAs(db, await createUser(db), doctor, tehranAt(3, 21))).rejects.toThrow('slot_taken');
  });

  it('the next grid slot is free (half-open with buffer)', async () => {
    const doctor = await createDoctor(db);
    await holdAs(db, await createUser(db), doctor, tehranAt(3, 21));
    await expect(holdAs(db, await createUser(db), doctor, tehranAt(3, 22))).resolves.toBeTruthy();
  });

  it('rejects off-grid and out-of-hours starts', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    await expect(holdAs(db, client, doctor, tehranAt(3, 21, 30))).rejects.toThrow('not_on_schedule');
    await expect(holdAs(db, client, doctor, tehranAt(3, 3))).rejects.toThrow('not_on_schedule');
  });

  it('rejects too soon and too far', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    await expect(holdAs(db, client, doctor, gridSlotAfter(1))).rejects.toThrow('too_soon');
    await expect(holdAs(db, client, doctor, tehranAt(40, 21))).rejects.toThrow('too_far');
  });

  it('needs the non-refundable tick inside 24h', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    const soon = gridSlotAfter(13);
    await expect(holdAs(db, client, doctor, soon, false)).rejects.toThrow('nonrefundable_ack_required');
    const id = await holdAs(db, client, doctor, soon, true);
    expect((await booking(id)).nonrefundable_ack_at).toBeTruthy();
  });

  it('requires adult confirmation and a client role (Review Focus 4)', async () => {
    const doctor = await createDoctor(db);
    await expect(holdAs(db, await createUser(db, { adult: false }), doctor, tehranAt(3, 21))).rejects.toThrow('adult_confirmation_required');
    await expect(holdAs(db, await createDoctor(db), doctor, tehranAt(3, 21))).rejects.toThrow('clients_only');
  });

  it('one live hold per client; an expired hold no longer counts', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    const first = await holdAs(db, client, doctor, tehranAt(3, 20));
    await expect(holdAs(db, client, doctor, tehranAt(3, 21))).rejects.toThrow('hold_exists');
    await db.query(`update bookings set hold_expires_at = now() - interval '1 min' where id = $1`, [first]);
    await expect(holdAs(db, client, doctor, tehranAt(3, 21))).resolves.toBeTruthy();
    expect((await booking(first)).booking_status).toBe('expired');
  });

  it('a stale hold by someone else frees the slot', async () => {
    const doctor = await createDoctor(db);
    const a = await holdAs(db, await createUser(db), doctor, tehranAt(3, 21));
    await db.query(`update bookings set hold_expires_at = now() - interval '1 min' where id = $1`, [a]);
    await expect(holdAs(db, await createUser(db), doctor, tehranAt(3, 21))).resolves.toBeTruthy();
  });

  it('time off and inactive doctors block holds', async () => {
    const doctor = await createDoctor(db);
    const start = tehranAt(3, 21);
    await db.query(`insert into time_off(doctor_id, starts_at, ends_at) values ($1, $2::timestamptz - interval '1 hour', $2::timestamptz + interval '3 hours')`, [doctor, start]);
    await expect(holdAs(db, await createUser(db), doctor, start)).rejects.toThrow('not_on_schedule');
    const inactive = await createDoctor(db, { active: false });
    await expect(holdAs(db, await createUser(db), inactive, start)).rejects.toThrow('doctor_unavailable');
  });
});

describe('confirm_payment', () => {
  it('confirms, records the payment and queues email + both reminders', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), tehranAt(3, 21));
    expect(await confirm(db, id)).toBe('confirmed');
    const b = await booking(id);
    expect(b.booking_status).toBe('confirmed');
    expect(b.hold_expires_at).toBeNull();
    const p = (await db.query<{ status: string; amount_cents: number }>('select status, amount_cents from payments where booking_id = $1', [id])).rows;
    expect(p).toEqual([{ status: 'paid', amount_cents: 5000 }]);
    expect(await jobs(`email:booking_confirmed:${id}`)).toHaveLength(1);
    expect(await jobs(`reminder:`)).toEqual(expect.arrayContaining([`reminder:1h:${id}`, `reminder:24h:${id}`]));
  });

  it('only queues the 1h reminder when the session is under 24h away', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), gridSlotAfter(13), true);
    await confirm(db, id);
    expect(await jobs(`reminder:24h:${id}`)).toEqual([]);
    expect(await jobs(`reminder:1h:${id}`)).toHaveLength(1);
  });

  it('ignores a duplicate event', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), tehranAt(3, 21));
    const args = ['evt_dup', id, 5000, 'usd', 'cs_dup', 'pi_dup'];
    expect(await rpc(db, 'service', 'select confirm_payment($1,$2,$3,$4,$5,$6) as r', args)).toBe('confirmed');
    expect(await rpc(db, 'service', 'select confirm_payment($1,$2,$3,$4,$5,$6) as r', args)).toBe('duplicate');
  });

  it('a late payment still confirms when nobody took the slot', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), tehranAt(3, 21));
    await db.query(`update bookings set hold_expires_at = now() - interval '5 min', booking_status = 'expired' where id = $1`, [id]);
    expect(await confirm(db, id)).toBe('confirmed');
  });

  it('a late payment after another client took the slot is refunded, never double-booked (Review Focus 1)', async () => {
    const doctor = await createDoctor(db);
    const late = await holdAs(db, await createUser(db), doctor, tehranAt(3, 21));
    await db.query(`update bookings set hold_expires_at = now() - interval '5 min' where id = $1`, [late]);
    const winner = await holdAs(db, await createUser(db), doctor, tehranAt(3, 21));
    expect(await confirm(db, winner)).toBe('confirmed');
    expect(await confirm(db, late)).toBe('slot_lost');
    expect((await booking(late)).booking_status).toBe('expired');
    const pay = (await db.query<{ id: string; status: string }>('select id, status from payments where booking_id = $1', [late])).rows[0]!;
    expect(pay.status).toBe('refund_pending');
    expect(await jobs(`refund:${pay.id}`)).toHaveLength(1);
    const live = await db.query<{ n: number }>(
      `select count(*)::int as n from bookings where doctor_id = $1 and booking_status = 'confirmed'`, [doctor]);
    expect(live.rows[0]!.n).toBe(1);
  });

  it('wrong amount or currency → mismatch and refund', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), tehranAt(3, 21));
    expect(await confirm(db, id, 4000)).toBe('mismatch');
    expect((await booking(id)).booking_status).toBe('held');
    const pay = (await db.query<{ id: string; status: string }>('select id, status from payments where booking_id = $1', [id])).rows[0]!;
    expect(pay.status).toBe('refund_pending');
    expect(await jobs(`refund:${pay.id}`)).toHaveLength(1);
  });

  it('unknown booking is reported to the admin', async () => {
    const r = await rpc(db, 'service', 'select confirm_payment($1,$2,$3,$4,$5,$6) as r',
      ['evt_unknown', crypto.randomUUID(), 5000, 'usd', 'cs_u', 'pi_u']);
    expect(r).toBe('unknown_booking');
    expect(await jobs('alert:unknown_booking:pi_u')).toHaveLength(1);
  });

  it('a second, different charge for a paid booking is flagged', async () => {
    const id = await holdAs(db, await createUser(db), await createDoctor(db), tehranAt(3, 21));
    await confirm(db, id);
    expect(await confirm(db, id)).toBe('duplicate_charge');
  });
});
