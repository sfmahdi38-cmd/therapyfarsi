import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createDb, createDoctor, createUser, type Who } from './harness';

let db: PGlite;
let doctor: string, otherDoctor: string, inactiveDoctor: string, client: string, otherClient: string, admin: string;
let booking: string;

const count = (who: Who, sql: string, params: unknown[] = []) =>
  as(db, who, async tx => (await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params)).rows[0]!.n);

beforeAll(async () => {
  db = await createDb();
  doctor = await createDoctor(db);
  otherDoctor = await createDoctor(db);
  inactiveDoctor = await createDoctor(db, { active: false });
  client = await createUser(db, { name: 'Sara Ahmadi' });
  otherClient = await createUser(db);
  admin = await createUser(db, { role: 'admin' });
  const b = await db.query<{ id: string }>(
    `insert into bookings(client_id, doctor_id, starts_at, ends_at, blocked_until, booking_status, price_cents, doctor_share_cents, share_rule, client_timezone)
     values ($1, $2, '2030-01-01T10:00Z', '2030-01-01T10:50Z', '2030-01-01T11:00Z', 'confirmed', 5000, 3500, '{}', 'Europe/London') returning id`,
    [client, doctor]);
  booking = b.rows[0]!.id;
  await db.query(`insert into payments(booking_id, amount_cents, status) values ($1, 5000, 'paid')`, [booking]);
  await db.query(`insert into doctor_notes(booking_id, doctor_id, body_enc) values ($1, $2, 'enc')`, [booking, doctor]);
  await db.query(`insert into doctor_ledger_entries(doctor_id, booking_id, type, amount_cents, source_key) values ($1, $2, 'session_earning', 3500, 'rls:1')`, [doctor, booking]);
});

describe('anon', () => {
  it('sees active doctors only', async () => {
    expect(await count('anon', 'select id from doctors where id = any($1)', [[doctor, inactiveDoctor]])).toBe(1);
  });
  it('sees no bookings, profiles or payments', async () => {
    expect(await count('anon', 'select id from bookings')).toBe(0);
    expect(await count('anon', 'select id from profiles')).toBe(0);
    expect(await count('anon', 'select id from payments')).toBe(0);
  });
});

describe('client', () => {
  it('sees own profile and booking only', async () => {
    expect(await count({ sub: client }, 'select id from profiles')).toBe(1);
    expect(await count({ sub: client }, 'select id from bookings')).toBe(1);
    expect(await count({ sub: otherClient }, 'select id from bookings')).toBe(0);
  });
  it('sees own payment, not others', async () => {
    expect(await count({ sub: client }, 'select id from payments')).toBe(1);
    expect(await count({ sub: otherClient }, 'select id from payments')).toBe(0);
  });
  it('cannot change own role (Review Focus 4 setup)', async () => {
    const updated = await as(db, { sub: client }, async tx =>
      (await tx.query(`update user_roles set role = 'admin' where user_id = $1`, [client])).affectedRows);
    expect(updated).toBe(0);
    await expect(as(db, { sub: client }, tx => tx.query(`insert into user_roles(user_id, role) values ($1, 'admin')`, [otherClient])))
      .rejects.toThrow(/row-level security/i);
  });
  it('cannot read doctor notes or ledger', async () => {
    expect(await count({ sub: client }, 'select booking_id from doctor_notes')).toBe(0);
    expect(await count({ sub: client }, 'select id from doctor_ledger_entries')).toBe(0);
  });
  it('gets nothing from doctor_bookings', async () => {
    expect(await count({ sub: client }, 'select id from doctor_bookings')).toBe(0);
  });
});

describe('doctor', () => {
  it('sees own bookings through the view, with the client first name', async () => {
    const rows = await as(db, { sub: doctor }, async tx =>
      (await tx.query<{ client_first_name: string }>('select client_first_name from doctor_bookings')).rows);
    expect(rows).toEqual([{ client_first_name: 'Sara' }]);
    expect(await count({ sub: otherDoctor }, 'select id from doctor_bookings')).toBe(0);
  });
  it('cannot see payments', async () => {
    expect(await count({ sub: doctor }, 'select id from payments')).toBe(0);
  });
  it('sees own notes and own ledger, not other doctors', async () => {
    expect(await count({ sub: doctor }, 'select booking_id from doctor_notes')).toBe(1);
    expect(await count({ sub: doctor }, 'select id from doctor_ledger_entries')).toBe(1);
    expect(await count({ sub: otherDoctor }, 'select id from doctor_ledger_entries')).toBe(0);
  });
  it('sees the profile of own client only', async () => {
    expect(await count({ sub: doctor }, 'select id from profiles where id = $1', [client])).toBe(1);
    expect(await count({ sub: doctor }, 'select id from profiles where id = $1', [otherClient])).toBe(0);
  });
  it('manages own availability but not another doctor’s', async () => {
    const mine = await as(db, { sub: doctor }, async tx =>
      (await tx.query(`delete from availability_rules where doctor_id = $1 and weekday = 0`, [doctor])).affectedRows);
    expect(mine).toBe(1);
    const theirs = await as(db, { sub: doctor }, async tx =>
      (await tx.query(`delete from availability_rules where doctor_id = $1`, [otherDoctor])).affectedRows);
    expect(theirs).toBe(0);
  });
});

describe('admin', () => {
  it('with aal1 sees nothing (Review Focus 5)', async () => {
    expect(await count({ sub: admin, aal: 'aal1' }, 'select id from bookings')).toBe(0);
    expect(await count({ sub: admin, aal: 'aal1' }, 'select id from payments')).toBe(0);
  });
  it('with aal2 sees bookings, payments and ledger', async () => {
    expect(await count({ sub: admin, aal: 'aal2' }, 'select id from bookings')).toBe(1);
    expect(await count({ sub: admin, aal: 'aal2' }, 'select id from payments')).toBe(1);
    expect(await count({ sub: admin, aal: 'aal2' }, 'select id from doctor_ledger_entries')).toBe(1);
  });
  it('never sees doctor notes, even with aal2', async () => {
    expect(await count({ sub: admin, aal: 'aal2' }, 'select booking_id from doctor_notes')).toBe(0);
  });
  it('with aal2 can change a role', async () => {
    const n = await as(db, { sub: admin, aal: 'aal2' }, async tx =>
      (await tx.query(`update user_roles set role = 'client' where user_id = $1`, [otherClient])).affectedRows);
    expect(n).toBe(1);
  });
});
