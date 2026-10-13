import { PGlite, type Transaction } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { TZDate } from '@date-fns/tz';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TEHRAN = 'Asia/Tehran';

export async function createDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(readFileSync(join(root, 'tests/db/shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

export type Who = 'anon' | 'service' | { sub: string; aal?: 'aal1' | 'aal2' };

export async function as<T>(db: PGlite, who: Who, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    if (who === 'anon') await tx.exec('set local role anon');
    else if (who === 'service') await tx.exec('set local role service_role');
    else {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: who.sub, role: 'authenticated', aal: who.aal ?? 'aal1' }),
      ]);
      await tx.exec('set local role authenticated');
    }
    return fn(tx);
  });
}

/** Run one statement whose single result column is aliased `r`. */
export async function rpc<T = unknown>(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<T> {
  return as(db, who, async tx => (await tx.query<{ r: T }>(sql, params)).rows[0]!.r);
}

let counter = 0;
export async function createUser(
  db: PGlite,
  opts: { role?: 'client' | 'doctor' | 'admin'; adult?: boolean; name?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query('insert into auth.users(id, email) values ($1, $2)', [id, `u${++counter}@test.local`]);
  if (opts.role && opts.role !== 'client') {
    await db.query('update user_roles set role = $2 where user_id = $1', [id, opts.role]);
  }
  await db.query('update profiles set full_name = $2, adult_confirmed_at = $3 where id = $1', [
    id, opts.name ?? 'Sara Test', opts.adult === false ? null : new Date(),
  ]);
  return id;
}

export async function createDoctor(
  db: PGlite,
  opts: { priceCents?: number; shareBps?: number; active?: boolean } = {},
): Promise<string> {
  const id = await createUser(db, { role: 'doctor', name: 'Ali Doctor' });
  await db.query(
    `insert into doctors(id, slug, gender, kind, price_cents, share_bps, is_active)
     values ($1, $2, 'male', 'psychologist', $3, $4, $5)`,
    [id, 'dr-' + id.slice(0, 8), opts.priceCents ?? 5000, opts.shareBps ?? 7000, opts.active ?? true],
  );
  for (let wd = 0; wd < 7; wd++) {
    await db.query(
      `insert into availability_rules(doctor_id, weekday, start_time, end_time) values ($1, $2, '08:00', '24:00')`,
      [id, wd],
    );
  }
  return id;
}

/** Tehran wall-clock time `daysAhead` days from today, returned as an absolute Date. */
export function tehranAt(daysAhead: number, hh: number, mm = 0): Date {
  const today = new TZDate(Date.now(), TEHRAN);
  return new Date(new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead, hh, mm, TEHRAN).getTime());
}

/** First hourly grid slot (Tehran 08:00–23:00) at or after now + hours. For 13 h this is always 13–22 h away. */
export function gridSlotAfter(hoursFromNow: number): Date {
  const z = new TZDate(Date.now() + hoursFromNow * 3_600_000, TEHRAN);
  const partial = z.getMinutes() > 0 || z.getSeconds() > 0 || z.getMilliseconds() > 0;
  let h = z.getHours() + (partial ? 1 : 0);
  let day = z.getDate();
  if (h >= 24) { h = 8; day += 1; } else if (h < 8) h = 8;
  return new Date(new TZDate(z.getFullYear(), z.getMonth(), day, h, 0, TEHRAN).getTime());
}
