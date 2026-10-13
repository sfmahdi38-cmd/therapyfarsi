import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, bookAndPay, createDb, createDoctor, createUser, moveToPast, rpc, tehranAt } from './harness';

let db: PGlite;
let admin: string;
beforeAll(async () => { db = await createDb(); admin = await createUser(db, { role: 'admin' }); });

const ADMIN = () => ({ sub: admin, aal: 'aal2' as const });
const ledger = async (doctor: string) =>
  (await db.query<{ type: string; amount_cents: number }>(
    'select type, amount_cents from doctor_ledger_entries where doctor_id = $1 order by created_at, source_key', [doctor])).rows;
const outcome = (id: string, status: string, overlap = 3000) =>
  rpc<string>(db, 'service', 'select record_session_outcome($1, $2, $3) as r', [id, status, overlap]);
const balance = async (doctor: string) =>
  (await as(db, ADMIN(), async tx =>
    (await tx.query<{ balance_cents: number }>('select balance_cents::int from doctor_balances where doctor_id = $1', [doctor])).rows[0]!.balance_cents));
const settle = (doctor: string, cents: number) =>
  rpc<string>(db, ADMIN(), 'select record_settlement($1, $2, $3, $4, now(), null, null) as r', [doctor, cents, cents * 600, 60000]);

async function endedBooking(opts: { doctorId?: string; startsAt?: Date; hoursAgo?: number } = {}) {
  const b = await bookAndPay(db, opts);
  await moveToPast(db, b.bookingId, opts.hoursAgo ?? 2);
  return b;
}

describe('record_session_outcome', () => {
  it('refuses before end + 10 minutes', async () => {
    const { bookingId } = await bookAndPay(db);
    await expect(outcome(bookingId, 'completed')).rejects.toThrow('too_early');
  });

  it('example A + F: completed earns once, even if recorded twice', async () => {
    const { bookingId, doctorId } = await endedBooking();
    expect(await outcome(bookingId, 'completed')).toBe('recorded');
    expect(await outcome(bookingId, 'completed')).toBe('recorded');
    expect(await ledger(doctorId)).toEqual([{ type: 'session_earning', amount_cents: 3500 }]);
    expect(await balance(doctorId)).toBe(3500);
    await settle(doctorId, 3500);
    expect(await balance(doctorId)).toBe(0);
  });

  it('no-show by client earns the share', async () => {
    const { bookingId, doctorId } = await endedBooking();
    await outcome(bookingId, 'no_show_client', 0);
    expect(await ledger(doctorId)).toEqual([{ type: 'no_show_earning', amount_cents: 3500 }]);
  });

  it('example C: partial earns nothing and opens the client choice; the replacement earns on one payment', async () => {
    const { bookingId, doctorId, clientId } = await endedBooking({ startsAt: tehranAt(3, 20) });
    await outcome(bookingId, 'partial', 600);
    expect(await ledger(doctorId)).toEqual([]);
    const next = await rpc<string>(db, { sub: clientId }, 'select reschedule_booking($1, $2) as r', [bookingId, tehranAt(4, 21)]);
    await moveToPast(db, next, 5);
    await outcome(next, 'completed');
    expect(await ledger(doctorId)).toEqual([{ type: 'session_earning', amount_cents: 3500 }]);
    const pays = await db.query<{ n: number }>('select count(*)::int as n from payments where booking_id in ($1, $2)', [bookingId, next]);
    expect(pays.rows[0]!.n).toBe(1);
  });

  it('a zero share never writes a zero-amount row (Review Focus 3)', async () => {
    const doctorId = await createDoctor(db, { shareBps: 0 });
    const { bookingId } = await endedBooking({ doctorId });
    await expect(outcome(bookingId, 'completed')).resolves.toBe('recorded');
    expect(await ledger(doctorId)).toEqual([]);
  });
});

describe('disputes and admin decisions', () => {
  it('example D: dispute moves to review, keeps the earning, blocks auto-outcome; admin resolves', async () => {
    const { bookingId, doctorId, clientId } = await endedBooking();
    await outcome(bookingId, 'completed');
    await rpc(db, { sub: clientId }, 'select open_dispute($1, $2) as r', [bookingId, 'audio was broken']);
    const b1 = await db.query<{ session_status: string }>('select session_status from bookings where id = $1', [bookingId]);
    expect(b1.rows[0]!.session_status).toBe('needs_review');
    expect(await ledger(doctorId)).toEqual([{ type: 'session_earning', amount_cents: 3500 }]);
    expect(await outcome(bookingId, 'completed')).toBe('under_review');
    await rpc(db, ADMIN(), 'select admin_set_outcome($1, $2, $3) as r', [bookingId, 'completed', 'checked logs']);
    const open = await db.query<{ n: number }>(`select count(*)::int as n from issues where booking_id = $1 and resolved_at is null`, [bookingId]);
    expect(open.rows[0]!.n).toBe(0);
    expect(await outcome(bookingId, 'partial')).toBe('admin_locked');
  });

  it('example E: settled earning reversed by an admin decision → negative balance', async () => {
    const { bookingId, doctorId } = await endedBooking();
    await outcome(bookingId, 'completed');
    await settle(doctorId, 3500);
    await rpc(db, ADMIN(), 'select admin_set_outcome($1, $2, $3) as r', [bookingId, 'no_show_doctor', 'doctor never joined']);
    expect(await ledger(doctorId)).toEqual([
      { type: 'session_earning', amount_cents: 3500 },
      { type: 'reversal', amount_cents: -3500 },
    ]);
    expect(await balance(doctorId)).toBe(-3500);
  });

  it('only participants can dispute, and only inside the window', async () => {
    const { bookingId, clientId } = await endedBooking();
    await expect(rpc(db, { sub: await createUser(db) }, 'select open_dispute($1, $2) as r', [bookingId, 'x'])).rejects.toThrow('forbidden');
    await moveToPast(db, bookingId, 30);
    await expect(rpc(db, { sub: clientId }, 'select open_dispute($1, $2) as r', [bookingId, 'x'])).rejects.toThrow('dispute_window_closed');
  });

  it('a connection report alerts the admin but does not change the outcome', async () => {
    const { bookingId, clientId } = await endedBooking();
    await outcome(bookingId, 'completed');
    const issue = await rpc<string>(db, { sub: clientId }, 'select report_connection_issue($1, $2) as r', [bookingId, 'lag']);
    const b = await db.query<{ session_status: string }>('select session_status from bookings where id = $1', [bookingId]);
    expect(b.rows[0]!.session_status).toBe('completed');
    const alert = await db.query<{ n: number }>('select count(*)::int as n from jobs where idempotency_key = $1', [`alert:connection:${issue}`]);
    expect(alert.rows[0]!.n).toBe(1);
  });

  it('admin functions refuse aal1 and non-admins (Review Focus 5)', async () => {
    const { bookingId, doctorId } = await endedBooking();
    await expect(rpc(db, { sub: admin, aal: 'aal1' }, 'select admin_set_outcome($1, $2, $3) as r', [bookingId, 'completed', 'x'])).rejects.toThrow('forbidden');
    await expect(rpc(db, { sub: doctorId, aal: 'aal2' }, 'select record_settlement($1, 100, null, null, now(), null, null) as r', [doctorId])).rejects.toThrow('forbidden');
  });
});

describe('record_settlement', () => {
  it('allocates FIFO, keeps overpayment as a negative balance', async () => {
    const doctorId = await createDoctor(db);
    const a = await endedBooking({ doctorId, startsAt: tehranAt(3, 20), hoursAgo: 4 });
    await outcome(a.bookingId, 'completed');
    const b = await endedBooking({ doctorId, startsAt: tehranAt(3, 22), hoursAgo: 2 });
    await outcome(b.bookingId, 'completed');
    const s1 = await settle(doctorId, 5000);
    const allocs = async (s: string) => (await db.query<{ amount_cents: number }>(
      `select a.amount_cents from settlement_allocations a join doctor_ledger_entries l on l.id = a.ledger_entry_id
       where a.settlement_id = $1 order by l.created_at`, [s])).rows.map(r => r.amount_cents);
    expect(await allocs(s1)).toEqual([3500, 1500]);
    const s2 = await settle(doctorId, 5000);
    expect(await allocs(s2)).toEqual([2000]);
    expect(await balance(doctorId)).toBe(-3000);
  });

  it('a doctor sees only their own balance', async () => {
    const doctorId = await createDoctor(db);
    const rows = await as(db, { sub: doctorId }, async tx =>
      (await tx.query<{ doctor_id: string }>('select doctor_id from doctor_balances')).rows);
    expect(rows).toEqual([{ doctor_id: doctorId }]);
  });
});
