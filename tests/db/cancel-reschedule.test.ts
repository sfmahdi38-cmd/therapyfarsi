import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bookAndPay, createDb, createUser, gridSlotAfter, moveToPast, rpc, tehranAt } from './harness';

let db: PGlite;
beforeAll(async () => { db = await createDb(); });

const booking = async (id: string) =>
  (await db.query<Record<string, unknown>>('select * from bookings where id = $1', [id])).rows[0]!;
const payment = async (bookingId: string) =>
  (await db.query<{ id: string; status: string }>('select id, status from payments where booking_id = $1', [bookingId])).rows[0];
const jobCount = async (key: string) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from jobs where idempotency_key = $1 and status = 'pending'`, [key])).rows[0]!.n;
const cancel = (who: string, id: string) => rpc<string>(db, { sub: who }, 'select cancel_booking($1) as r', [id]);
const reschedule = (who: string, id: string, at: Date) =>
  rpc<string>(db, { sub: who }, 'select reschedule_booking($1, $2) as r', [id, at]);

describe('cancel_booking', () => {
  it('client ≥24h before → full refund queued', async () => {
    const { bookingId, clientId } = await bookAndPay(db);
    expect(await cancel(clientId, bookingId)).toBe('full');
    const b = await booking(bookingId);
    expect([b.booking_status, b.session_status]).toEqual(['cancelled', 'void']);
    const p = (await payment(bookingId))!;
    expect(p.status).toBe('refund_pending');
    expect(await jobCount(`refund:${p.id}:full`)).toBe(1);
    expect(await jobCount(`reminder:24h:${bookingId}`)).toBe(0);
  });

  it('client <24h before → no refund, late-cancel earning once', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db, { startsAt: gridSlotAfter(13), ack: true });
    expect(await cancel(clientId, bookingId)).toBe('none');
    const l = await db.query<{ type: string; amount_cents: number; source_key: string }>(
      'select type, amount_cents, source_key from doctor_ledger_entries where doctor_id = $1', [doctorId]);
    expect(l.rows).toEqual([{ type: 'late_cancel_earning', amount_cents: 3500, source_key: `booking:${bookingId}:late_cancel` }]);
    await expect(cancel(clientId, bookingId)).rejects.toThrow('not_cancellable');
  });

  it('doctor cancel → client chooses; no refund until chosen', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db);
    expect(await cancel(doctorId, bookingId)).toBe('client_choice');
    expect((await booking(bookingId)).choice_deadline).toBeTruthy();
    expect((await payment(bookingId))!.status).toBe('paid');
    expect(await jobCount(`choice_deadline:${bookingId}`)).toBe(1);
    await rpc(db, { sub: clientId }, 'select choose_refund($1) as r', [bookingId]);
    const p = (await payment(bookingId))!;
    expect(p.status).toBe('refund_pending');
    expect(await jobCount(`refund:${p.id}:full`)).toBe(1);
    await expect(rpc(db, { sub: clientId }, 'select choose_refund($1) as r', [bookingId])).rejects.toThrow('no_choice_pending');
  });

  it('strangers cannot cancel; nobody cancels after start', async () => {
    const { bookingId, clientId } = await bookAndPay(db);
    await expect(cancel(await createUser(db), bookingId)).rejects.toThrow('forbidden');
    await moveToPast(db, bookingId, 0.1);
    await expect(cancel(clientId, bookingId)).rejects.toThrow('already_started');
  });

  it('a client may release their own unpaid hold', async () => {
    const doctor = (await bookAndPay(db)).doctorId;
    const client = await createUser(db);
    const held = await rpc<string>(db, { sub: client }, 'select hold_slot($1, $2, $3, false) as r', [doctor, tehranAt(4, 21), 'UTC']);
    expect(await cancel(client, held)).toBe('released');
  });
});

describe('resolve_choice_deadline', () => {
  it('refunds once the deadline passes without a choice', async () => {
    const { bookingId, doctorId } = await bookAndPay(db);
    await cancel(doctorId, bookingId);
    expect(await rpc(db, 'service', 'select resolve_choice_deadline($1) as r', [bookingId])).toBe('not_due');
    await db.query(`update bookings set choice_deadline = now() - interval '1 min' where id = $1`, [bookingId]);
    expect(await rpc(db, 'service', 'select resolve_choice_deadline($1) as r', [bookingId])).toBe('refunded');
    expect((await booking(bookingId)).refund_choice).toBe('refund');
  });
});

describe('reschedule_booking', () => {
  it('normal reschedule ≥24h: old released, new confirmed on the same payment', async () => {
    const { bookingId, clientId } = await bookAndPay(db);
    const next = await reschedule(clientId, bookingId, tehranAt(5, 20));
    const old = await booking(bookingId);
    expect([old.booking_status, old.session_status, old.cancel_reason]).toEqual(['cancelled', 'void', 'rescheduled']);
    const nb = await booking(next);
    expect([nb.booking_status, nb.root_booking_id, nb.previous_booking_id]).toEqual(['confirmed', bookingId, bookingId]);
    const pays = await db.query<{ n: number }>('select count(*)::int as n from payments where booking_id in ($1, $2)', [bookingId, next]);
    expect(pays.rows[0]!.n).toBe(1);
    expect(await jobCount(`reminder:24h:${bookingId}`)).toBe(0);
    expect(await jobCount(`reminder:24h:${next}`)).toBe(1);
  });

  it('can move into a slot overlapping its own old booking (Review Focus 2)', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db, { startsAt: tehranAt(3, 20) });
    for (let wd = 0; wd < 7; wd++) {
      await db.query(`insert into availability_rules(doctor_id, weekday, start_time, end_time) values ($1, $2, '08:30', '24:00')`, [doctorId, wd]);
    }
    // old occupies [20:00, 21:00); 20:30 overlaps it and is only possible because the old booking is released first
    await expect(reschedule(clientId, bookingId, tehranAt(3, 20, 30))).resolves.toBeTruthy();
  });

  it('a taken slot leaves the old booking untouched', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db, { startsAt: tehranAt(3, 20) });
    await bookAndPay(db, { doctorId, startsAt: tehranAt(3, 22) });
    await expect(reschedule(clientId, bookingId, tehranAt(3, 22))).rejects.toThrow('slot_taken');
    const b = await booking(bookingId);
    expect([b.booking_status, b.session_status]).toEqual(['confirmed', 'scheduled']);
  });

  it('under 24h, a normal reschedule is refused', async () => {
    const { bookingId, clientId } = await bookAndPay(db, { startsAt: gridSlotAfter(13), ack: true });
    await expect(reschedule(clientId, bookingId, tehranAt(5, 20))).rejects.toThrow('not_reschedulable');
  });

  it('after a doctor cancel the client reschedules for free, keeping the payment', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db);
    await cancel(doctorId, bookingId);
    const next = await reschedule(clientId, bookingId, tehranAt(4, 10));
    expect((await booking(bookingId)).refund_choice).toBe('reschedule');
    expect((await booking(next)).root_booking_id).toBe(bookingId);
    expect((await payment(bookingId))!.status).toBe('paid');
  });

  it('another client cannot reschedule', async () => {
    const { bookingId } = await bookAndPay(db);
    await expect(reschedule(await createUser(db), bookingId, tehranAt(5, 20))).rejects.toThrow('forbidden');
  });
});
