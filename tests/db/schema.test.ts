import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, createDoctor, createUser } from './harness';

let db: PGlite;
beforeAll(async () => { db = await createDb(); });

describe('core schema', () => {
  it('creates every table', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
    expect(rows.map(r => r.table_name).sort()).toEqual([
      'audit_log', 'availability_rules', 'bookings', 'client_admin_notes', 'consents', 'doctor_ledger_entries',
      'doctor_notes', 'doctors', 'intake_responses', 'issues', 'jobs', 'payments', 'policy_versions', 'profiles',
      'refunds', 'reviews', 'session_events', 'settings', 'settlement_allocations', 'settlements', 'stripe_events',
      'time_off', 'user_roles',
    ]);
  });

  it('a new auth user gets a profile and the client role', async () => {
    const id = await createUser(db);
    const { rows } = await db.query<{ role: string }>(
      'select r.role from profiles p join user_roles r on r.user_id = p.id where p.id = $1', [id]);
    expect(rows[0]?.role).toBe('client');
  });

  it('rejects a doctor share that leaves the agency nothing after the estimated fee', async () => {
    const id = await createUser(db, { role: 'doctor' });
    await expect(db.query(
      `insert into doctors(id, slug, gender, kind, price_cents, share_fixed_cents) values ($1, 'x1', 'male', 'counselor', 5000, 4800)`, [id],
    )).rejects.toThrow(/check/i);
  });

  it('rejects both share kinds at once', async () => {
    const id = await createUser(db, { role: 'doctor' });
    await expect(db.query(
      `insert into doctors(id, slug, gender, kind, price_cents, share_bps, share_fixed_cents) values ($1, 'x2', 'male', 'counselor', 5000, 7000, 3000)`, [id],
    )).rejects.toThrow(/check/i);
  });

  it('accepts a rule ending at 24:00', async () => {
    const doctor = await createDoctor(db);
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from availability_rules where doctor_id = $1 and end_time = '24:00'`, [doctor]);
    expect(rows[0]?.n).toBe(7);
  });

  it('blocks overlapping live bookings but ignores cancelled ones', async () => {
    const doctor = await createDoctor(db);
    const client = await createUser(db);
    const insert = (status: string, start: string) => db.query(
      `insert into bookings(client_id, doctor_id, starts_at, ends_at, blocked_until, booking_status, price_cents, doctor_share_cents, share_rule, client_timezone)
       values ($1, $2, $3::timestamptz, $3::timestamptz + interval '50 min', $3::timestamptz + interval '60 min', $4, 5000, 3500, '{}', 'UTC')`,
      [client, doctor, start, status]);
    await insert('confirmed', '2030-01-01T10:00:00Z');
    await insert('cancelled', '2030-01-01T10:30:00Z');
    await insert('confirmed', '2030-01-01T11:00:00Z'); // half-open: starts exactly at blocked_until
    await expect(insert('held', '2030-01-01T10:30:00Z')).rejects.toThrow(/exclusion/i);
  });

  it('ledger and settlements are append-only', async () => {
    const doctor = await createDoctor(db);
    await db.query(`insert into doctor_ledger_entries(doctor_id, type, amount_cents, source_key) values ($1, 'adjustment', 100, 'test:imm')`, [doctor]);
    await expect(db.query(`update doctor_ledger_entries set amount_cents = 1 where source_key = 'test:imm'`)).rejects.toThrow('immutable_table');
    await expect(db.query(`delete from doctor_ledger_entries where source_key = 'test:imm'`)).rejects.toThrow('immutable_table');
    await db.query(`insert into settlements(doctor_id, amount_cents, paid_at) values ($1, 100, now())`, [doctor]);
    await expect(db.query(`delete from settlements where doctor_id = $1`, [doctor])).rejects.toThrow('immutable_table');
  });

  it('seeds settings and a first policy version', async () => {
    const { rows } = await db.query<{ v: number }>(`select app_setting_int('hold_minutes') as v`);
    expect(rows[0]?.v).toBe(30);
    const p = await db.query<{ n: number }>('select count(*)::int as n from policy_versions');
    expect(p.rows[0]?.n).toBe(1);
  });
});
