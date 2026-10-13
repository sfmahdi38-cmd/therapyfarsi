// Regressions for the final review of plan 2 (findings #1–#9).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, bookAndPay, confirm, createDb, createDoctor, createUser, gridSlotAfter, holdAs, moveToPast, rpc, tehranAt } from './harness';

let db: PGlite;
let admin: string;
beforeAll(async () => { db = await createDb(); admin = await createUser(db, { role: 'admin' }); });

const ADMIN = () => ({ sub: admin, aal: 'aal2' as const });
const outcome = (id: string, status: string) =>
  rpc<string>(db, 'service', 'select record_session_outcome($1, $2, 600) as r', [id, status]);
const ledger = async (doctor: string) =>
  (await db.query<{ type: string; amount_cents: number }>(
    'select type, amount_cents from doctor_ledger_entries where doctor_id = $1 order by created_at', [doctor])).rows;
const refundJobs = async (bookingId: string) =>
  (await db.query<{ n: number }>(
    `select count(*)::int as n from jobs j join payments p on j.idempotency_key like 'refund:' || p.id || '%'
     where p.booking_id = $1`, [bookingId])).rows[0]!.n;
const intentOf = async (bookingId: string) =>
  (await db.query<{ i: string }>('select stripe_payment_intent_id as i from payments where booking_id = $1 and not is_duplicate', [bookingId])).rows[0]!.i;

async function partialBooking() {
  const b = await bookAndPay(db, { startsAt: tehranAt(3, 20) });
  await moveToPast(db, b.bookingId, 2);
  await outcome(b.bookingId, 'partial');
  return b;
}

describe('#1 refund and earning never both', () => {
  it('admin turning a partial into completed closes the client choice', async () => {
    const { bookingId, doctorId } = await partialBooking();
    await rpc(db, { sub: doctorId }, 'select open_dispute($1, $2) as r', [bookingId, 'we finished']);
    await rpc(db, ADMIN(), 'select admin_set_outcome($1, $2, $3) as r', [bookingId, 'completed', 'ok']);
    await db.query(`update bookings set choice_deadline = now() - interval '1 min' where id = $1 and choice_deadline is not null`, [bookingId]);
    expect(await rpc(db, 'service', 'select resolve_choice_deadline($1) as r', [bookingId])).toBe('not_due');
    expect(await refundJobs(bookingId)).toBe(0);
    expect(await ledger(doctorId)).toEqual([{ type: 'session_earning', amount_cents: 3500 }]);
  });

  it('after the client chose a refund, a repeated finalize cannot create an earning', async () => {
    const { bookingId, clientId, doctorId } = await partialBooking();
    await rpc(db, { sub: clientId }, 'select choose_refund($1) as r', [bookingId]);
    expect(await outcome(bookingId, 'completed')).toBe('choice_made');
    expect(await ledger(doctorId)).toEqual([]);
  });
});

describe('#2 one payment never pays the doctor twice', () => {
  it('admin cannot make the original earn after the client moved to a replacement', async () => {
    const { bookingId, clientId } = await partialBooking();
    await rpc(db, { sub: clientId }, 'select reschedule_booking($1, $2) as r', [bookingId, tehranAt(4, 21)]);
    await expect(rpc(db, ADMIN(), 'select admin_set_outcome($1, $2, $3) as r', [bookingId, 'completed', 'x']))
      .rejects.toThrow('choice_already_made');
  });
});

describe('#3 clients cannot write their own intake', () => {
  it('direct insert is refused', async () => {
    const client = await createUser(db);
    await expect(as(db, { sub: client }, tx =>
      tx.query(`insert into intake_responses(client_id, answers_enc, risk_flag) values ($1, 'x', false)`, [client])))
      .rejects.toThrow(/row-level security/i);
  });
});

describe('#4 doctors see only what a confirmed booking needs', () => {
  it('a released hold reveals nothing; a confirmed booking reveals intake and first name, never email', async () => {
    const doctor = await createDoctor(db);
    const released = await createUser(db, { name: 'Nima Released' });
    await db.query(`insert into intake_responses(client_id, answers_enc, risk_flag) values ($1, 'enc', true)`, [released]);
    const held = await holdAs(db, released, doctor, tehranAt(5, 20));
    await rpc(db, { sub: released }, 'select cancel_booking($1) as r', [held]);
    const seen = (sql: string, p: unknown[]) => as(db, { sub: doctor }, async tx => (await tx.query(sql, p)).rows.length);
    expect(await seen('select id from profiles where id = $1', [released])).toBe(0);
    expect(await seen('select id from intake_responses where client_id = $1', [released])).toBe(0);

    const { clientId } = await bookAndPay(db, { doctorId: doctor, startsAt: tehranAt(5, 22) });
    await db.query(`insert into intake_responses(client_id, answers_enc) values ($1, 'enc')`, [clientId]);
    expect(await seen('select id from profiles where id = $1', [clientId])).toBe(0);
    expect(await seen('select id from intake_responses where client_id = $1', [clientId])).toBe(1);
    const names = await as(db, { sub: doctor }, async tx =>
      (await tx.query<{ client_first_name: string }>('select client_first_name from doctor_bookings where client_id = $1', [clientId])).rows);
    expect(names).toEqual([{ client_first_name: 'Sara' }]);
  });
});

describe('#5 no automatic earning on a disputed payment', () => {
  it('finalize after a chargeback writes nothing', async () => {
    const { bookingId, doctorId } = await bookAndPay(db);
    await moveToPast(db, bookingId, 2);
    await rpc(db, 'service', 'select mark_payment_disputed($1) as r', [await intentOf(bookingId)]);
    await outcome(bookingId, 'completed');
    expect(await ledger(doctorId)).toEqual([]);
  });
});

describe('#6 a second charge is recorded and refunded', () => {
  it('duplicate charge gets its own row and a refund job', async () => {
    const { bookingId } = await bookAndPay(db);
    expect(await confirm(db, bookingId)).toBe('duplicate_charge');
    const dup = (await db.query<{ id: string; status: string; stripe_payment_intent_id: string }>(
      'select id, status, stripe_payment_intent_id from payments where booking_id = $1 and is_duplicate', [bookingId])).rows[0]!;
    expect(dup.status).toBe('refund_pending');
    const jobs = await db.query<{ n: number }>('select count(*)::int as n from jobs where idempotency_key = $1', [`refund:${dup.id}`]);
    expect(jobs.rows[0]!.n).toBe(1);
    await rpc(db, 'service', 'select record_refund_result($1, $2, 5000, $3) as r', ['re_dup', dup.stripe_payment_intent_id, 'succeeded']);
    const after = await db.query<{ status: string }>('select status from payments where id = $1', [dup.id]);
    expect(after.rows[0]!.status).toBe('refunded_full');
  });
});

describe('#7 a disputed payment is never refunded on top', () => {
  it('early cancel keeps the dispute and alerts the admin instead', async () => {
    const { bookingId, clientId } = await bookAndPay(db);
    await rpc(db, 'service', 'select mark_payment_disputed($1) as r', [await intentOf(bookingId)]);
    expect(await rpc(db, { sub: clientId }, 'select cancel_booking($1) as r', [bookingId])).toBe('full');
    const p = await db.query<{ status: string }>('select status from payments where booking_id = $1', [bookingId]);
    expect(p.rows[0]!.status).toBe('disputed');
    expect(await refundJobs(bookingId)).toBe(0);
    const alert = await db.query<{ n: number }>(`select count(*)::int as n from jobs where idempotency_key = $1`, [`alert:refund_blocked_dispute:${bookingId}`]);
    expect(alert.rows[0]!.n).toBe(1);
  });
});

describe('#8 reschedule into the no-refund window needs the tick', () => {
  it('refuses without ack, records it with ack', async () => {
    const { bookingId, clientId, doctorId } = await bookAndPay(db);
    await rpc(db, { sub: doctorId }, 'select cancel_booking($1) as r', [bookingId]); // free reschedule allowed
    const soon = gridSlotAfter(13);
    await expect(rpc(db, { sub: clientId }, 'select reschedule_booking($1, $2) as r', [bookingId, soon]))
      .rejects.toThrow('nonrefundable_ack_required');
    const next = await rpc<string>(db, { sub: clientId }, 'select reschedule_booking($1, $2, true) as r', [bookingId, soon]);
    const b = await db.query<{ nonrefundable_ack_at: Date | null }>('select nonrefundable_ack_at from bookings where id = $1', [next]);
    expect(b.rows[0]!.nonrefundable_ack_at).toBeTruthy();
  });
});

describe('#9 one live hold per client is enforced by the database', () => {
  it('a second held row for the same client is rejected even without hold_slot', async () => {
    const client = await createUser(db);
    await holdAs(db, client, await createDoctor(db), tehranAt(3, 20));
    const other = await createDoctor(db);
    await expect(db.query(
      `insert into bookings(client_id, doctor_id, starts_at, ends_at, blocked_until, booking_status, price_cents, doctor_share_cents, share_rule, client_timezone)
       values ($1, $2, now() + interval '3 days', now() + interval '3 days 50 min', now() + interval '3 days 60 min', 'held', 5000, 3500, '{}', 'UTC')`,
      [client, other])).rejects.toThrow(/bookings_one_hold_per_client/);
  });
});
