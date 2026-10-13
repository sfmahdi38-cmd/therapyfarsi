import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, bookAndPay, createDb, createUser, rpc, tehranAt, type Who } from './harness';

let db: PGlite;
beforeAll(async () => { db = await createDb(); });

const claim = (n: number) => as(db, 'service', async tx =>
  (await tx.query<{ id: string; idempotency_key: string; attempts: number }>('select * from claim_jobs($1)', [n])).rows);
const addJob = (key: string, runAt = 'now()') =>
  db.query(`insert into jobs(type, idempotency_key, run_at) values ('test', $1, ${runAt})`, [key]);

describe('job queue', () => {
  it('claims due jobs once, skips future ones, reclaims stale locks', async () => {
    await db.query(`update jobs set status = 'done'`); // clear jobs created by other tests' fixtures
    await addJob('q:due');
    await addJob('q:future', `now() + interval '1 hour'`);
    const first = await claim(10);
    expect(first.map(j => j.idempotency_key)).toEqual(['q:due']);
    expect(first[0]!.attempts).toBe(1);
    expect(await claim(10)).toEqual([]);
    await db.query(`update jobs set locked_at = now() - interval '10 min' where idempotency_key = 'q:due'`);
    expect((await claim(10)).map(j => j.idempotency_key)).toEqual(['q:due']);
  });

  it('fail_job retries with backoff, then gives up', async () => {
    await addJob('q:fail');
    await db.query(`update jobs set max_attempts = 2 where idempotency_key = 'q:fail'`);
    const id = (await db.query<{ id: string }>(`select id from jobs where idempotency_key = 'q:fail'`)).rows[0]!.id;
    await db.query(`update jobs set status = 'running', attempts = 1 where id = $1`, [id]);
    expect(await rpc(db, 'service', 'select fail_job($1, $2) as r', [id, 'boom'])).toBe('retry');
    const j = (await db.query<{ status: string; run_at: Date }>('select status, run_at from jobs where id = $1', [id])).rows[0]!;
    expect(j.status).toBe('pending');
    expect(j.run_at.getTime()).toBeGreaterThan(Date.now());
    await db.query(`update jobs set status = 'running', attempts = 2 where id = $1`, [id]);
    expect(await rpc(db, 'service', 'select fail_job($1, $2) as r', [id, 'boom'])).toBe('failed');
  });

  it('complete_job marks done', async () => {
    await addJob('q:done');
    const id = (await db.query<{ id: string }>(`select id from jobs where idempotency_key = 'q:done'`)).rows[0]!.id;
    await rpc(db, 'service', 'select complete_job($1) as r', [id]);
    expect((await db.query<{ status: string }>('select status from jobs where id = $1', [id])).rows[0]!.status).toBe('done');
  });
});

describe('payment webhooks', () => {
  const pi = async (bookingId: string) =>
    (await db.query<{ stripe_payment_intent_id: string }>('select stripe_payment_intent_id from payments where booking_id = $1', [bookingId])).rows[0]!.stripe_payment_intent_id;
  const pay = async (bookingId: string) =>
    (await db.query<{ status: string; refunded_cents: number; fee_cents: number | null }>(
      'select status, refunded_cents, fee_cents from payments where booking_id = $1', [bookingId])).rows[0]!;

  it('refund results update the payment; repeats are idempotent; failures stay pending', async () => {
    const { bookingId } = await bookAndPay(db);
    const intent = await pi(bookingId);
    await rpc(db, 'service', 'select record_refund_result($1, $2, $3, $4) as r', ['re_1', intent, 2000, 'succeeded']);
    expect(await pay(bookingId)).toMatchObject({ status: 'refunded_partial', refunded_cents: 2000 });
    await rpc(db, 'service', 'select record_refund_result($1, $2, $3, $4) as r', ['re_1', intent, 2000, 'succeeded']);
    expect(await pay(bookingId)).toMatchObject({ refunded_cents: 2000 });
    await rpc(db, 'service', 'select record_refund_result($1, $2, $3, $4) as r', ['re_2', intent, 3000, 'failed']);
    expect(await pay(bookingId)).toMatchObject({ status: 'refund_pending', refunded_cents: 2000 });
    await rpc(db, 'service', 'select record_refund_result($1, $2, $3, $4) as r', ['re_3', intent, 3000, 'succeeded']);
    expect(await pay(bookingId)).toMatchObject({ status: 'refunded_full', refunded_cents: 5000 });
  });

  it('disputes and fees are recorded', async () => {
    const { bookingId } = await bookAndPay(db);
    const intent = await pi(bookingId);
    await rpc(db, 'service', 'select set_payment_fee($1, $2, $3) as r', [intent, 175, 'usd']);
    await rpc(db, 'service', 'select mark_payment_disputed($1) as r', [intent]);
    expect(await pay(bookingId)).toMatchObject({ status: 'disputed', fee_cents: 175 });
    const alert = await db.query<{ n: number }>('select count(*)::int as n from jobs where idempotency_key = $1', [`alert:payment_disputed:${intent}`]);
    expect(alert.rows[0]!.n).toBe(1);
  });
});

describe('permissions', () => {
  const tryCall = (who: Who, sql: string, params: unknown[] = []) => rpc(db, who, sql, params);

  it('service-only functions refuse anon and signed-in users', async () => {
    const client = await createUser(db);
    for (const who of ['anon', { sub: client }] as Who[]) {
      await expect(tryCall(who, `select confirm_payment('e', gen_random_uuid(), 1, 'usd', 'c', 'p') as r`)).rejects.toThrow(/permission denied/);
      await expect(tryCall(who, 'select count(*) as r from claim_jobs(1)')).rejects.toThrow(/permission denied/);
      await expect(tryCall(who, `select app_enqueue('x', '{}', 'k') as r`)).rejects.toThrow(/permission denied/);
      await expect(tryCall(who, `select record_session_outcome(gen_random_uuid(), 'completed', 1) as r`)).rejects.toThrow(/permission denied/);
    }
  });

  it('anon cannot hold a slot', async () => {
    await expect(tryCall('anon', `select hold_slot(gen_random_uuid(), now(), 'UTC', false) as r`)).rejects.toThrow(/permission denied/);
  });
});

describe('audit log', () => {
  it('records booking changes and settlements with the actor', async () => {
    const { bookingId, clientId } = await bookAndPay(db);
    await rpc(db, { sub: clientId }, 'select cancel_booking($1) as r', [bookingId]);
    const rows = await db.query<{ action: string; actor_id: string | null }>(
      `select action, actor_id from audit_log where entity = 'bookings' and entity_id = $1 order by id`, [bookingId]);
    expect(rows.rows.map(r => r.action)).toEqual(['INSERT', 'UPDATE', 'UPDATE']); // hold, confirm, cancel
    expect(rows.rows.at(-1)!.actor_id).toBe(clientId);
  });

  it('audit rows cannot be changed', async () => {
    await expect(db.query('delete from audit_log')).rejects.toThrow('immutable_table');
  });
});

void tehranAt;
