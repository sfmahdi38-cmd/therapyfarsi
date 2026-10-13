# Domain Logic (Plan 1 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure, fully tested TypeScript functions for every money/time/outcome rule in the spec, so the database functions, webhooks and UI built in later plans all call one source of truth.

**Architecture:** A dependency-free `src/domain/` folder of small modules (one rule family per file). No I/O, no clock reads — `now` is always a parameter. Later plans (database, Next.js app) import these.

**Tech Stack:** TypeScript 5, Vitest, `date-fns` v4 + `@date-fns/tz`.

**Spec:** `docs/superpowers/specs/2026-10-13-tropifarsi-design.md` (sections 4-5, 4-8, 7, 8-3, 8-4, and 16 override).

**Later plans (not this one):** 2 = Supabase schema/RLS/SQL functions (PGlite tests); 3 = video test page (step 0-الف); 4 = Next.js on Cloudflare slice; 5 = UI and panels; 6 = operations.

## Global Constraints

- All money is integer **cents** in USD; never floats in storage or return values.
- All instants are `Date` (UTC). Doctor weekly rules are wall-clock times in `Asia/Tehran`.
- Weekday numbering: `0 = Sunday … 6 = Saturday`, evaluated in `Asia/Tehran`.
- Busy intervals are half-open `[startsAt, blockedUntil)`; the next session may start exactly at `blockedUntil`.
- Defaults (spec 4-5): min lead 12 h, max horizon 30 days, refund window 24 h, hold 30 min, completion threshold 50 % of session length, waiting window 15 min with 2 min tolerance, overlap counted only inside `[startsAt, endsAt + 10 min]`, presence under 60 s total counts as absent, ready-to-pay delay 24 h.
- Stripe fee estimate for validating shares: `ceil(price × 4.4 %) + 30` cents.
- Domain functions never read the clock; `now: Date` is always passed in.

## Review Focus

1. A weekly rule ending at `24:00` (midnight) — expected: last slot still offered, no crash. → Task 3 test.
2. Duplicate `joined` events (two browser tabs) or events arriving out of order — expected: presence merged, not double counted. → Task 5 test.
3. Admin pays a doctor more than the balance — expected: balance goes negative, allocations never exceed entries' remaining capacity. → Task 6 test.
4. Percent share on an odd price (4999 × 70 %) — expected: rounded to nearest cent (3499), validation still applied. → Task 2 test.
5. Client in a half-hour timezone (Asia/Kolkata, +05:30) for evening scoring — expected: evening computed in their local clock. → Task 7 test.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts
src/domain/
  types.ts         shared types (SessionStatus, LedgerEntry, …)
  money.ts         share calculation, share validation, agency remainder
  booking-rules.ts lead/horizon checks, non-refundable-ack rule, reminder schedule
  slots.ts         weekly rules → bookable slots (Tehran tz)
  cancellation.ts  cancellation decision table
  attendance.ts    presence intervals + session judgement (spec 4-8 order)
  ledger.ts        balance, ready-to-pay, FIFO allocation, entry status
  matching.ts      doctor ranking for the questionnaire
tests/domain/*.test.ts  one test file per module
```

---

### Task 1: Project setup + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/domain/types.ts`
- Test: `tests/domain/smoke.test.ts`

**Interfaces:**
- Produces: all types in `src/domain/types.ts` (used by every later task).

- [ ] **Step 1: Initialise and install**

```bash
npm init -y
npm i date-fns @date-fns/tz
npm i -D typescript vitest @types/node
```

- [ ] **Step 2: Write config files**

`package.json` — set `"type": "module"` and scripts:
```json
"scripts": { "test": "vitest run", "test:watch": "vitest", "typecheck": "tsc --noEmit" }
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "esModuleInterop": true, "baseUrl": ".", "paths": { "@/*": ["src/*"] }
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules
.next
.open-next
.wrangler
.env*
!.env.example
coverage
```

- [ ] **Step 3: Write types**

`src/domain/types.ts`:
```ts
export type BookingStatus = 'held' | 'confirmed' | 'expired' | 'cancelled';
export type SessionStatus =
  | 'scheduled' | 'completed' | 'partial' | 'no_show_client'
  | 'no_show_doctor' | 'needs_review' | 'void';
export type PaymentStatus =
  | 'pending' | 'paid' | 'failed' | 'refund_pending'
  | 'refunded_partial' | 'refunded_full' | 'disputed';
export type LedgerType =
  | 'session_earning' | 'no_show_earning' | 'late_cancel_earning'
  | 'reversal' | 'adjustment';

export type Share = { kind: 'bps'; bps: number } | { kind: 'fixed'; cents: number };

export interface LedgerEntry {
  id: string;
  doctorId: string;
  bookingId: string | null;
  type: LedgerType;
  amountCents: number; // positive or negative
  sourceKey: string;
  createdAt: Date;
}

export interface Settlement {
  id: string;
  doctorId: string;
  amountCents: number;
  paidAt: Date;
}

export interface Allocation {
  settlementId: string;
  ledgerEntryId: string;
  amountCents: number;
}

export interface Interval { start: Date; end: Date } // half-open [start, end)

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
```

- [ ] **Step 4: Smoke test**

`tests/domain/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { HOUR, DAY } from '@/domain/types';

describe('setup', () => {
  it('constants', () => {
    expect(DAY).toBe(24 * HOUR);
  });
});
```

Run: `npm test` → Expected: 1 passed. Run: `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src tests
git commit -m "chore: TypeScript + Vitest setup and shared domain types"
```

---

### Task 2: Money — doctor share, share validation, agency remainder

**Files:**
- Create: `src/domain/money.ts`
- Test: `tests/domain/money.test.ts`

**Interfaces:**
- Consumes: `Share` from `types.ts`.
- Produces:
  - `computeShareCents(priceCents: number, share: Share): number`
  - `estimateStripeFeeCents(priceCents: number): number`
  - `validateShare(priceCents: number, share: Share): { ok: true } | { ok: false; error: 'invalid_price' | 'invalid_share' | 'share_not_below_price' | 'agency_negative_after_fee' }`
  - `agencyRemainderCents(p: { amountCents: number; refundedCents: number; feeCents: number; doctorEntriesCents: number }): number`

- [ ] **Step 1: Write failing tests**

`tests/domain/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  computeShareCents, estimateStripeFeeCents, validateShare, agencyRemainderCents,
} from '@/domain/money';

describe('computeShareCents', () => {
  it('percent share in basis points', () => {
    expect(computeShareCents(5000, { kind: 'bps', bps: 7000 })).toBe(3500);
  });
  it('rounds odd cents to nearest (Review Focus 4)', () => {
    expect(computeShareCents(4999, { kind: 'bps', bps: 7000 })).toBe(3499); // 3499.3
    expect(computeShareCents(4995, { kind: 'bps', bps: 7000 })).toBe(3497); // 3496.5 → 3497
  });
  it('fixed share', () => {
    expect(computeShareCents(5000, { kind: 'fixed', cents: 3000 })).toBe(3000);
  });
});

describe('estimateStripeFeeCents', () => {
  it('4.4% rounded up plus 30 cents', () => {
    expect(estimateStripeFeeCents(5000)).toBe(250); // 220 + 30
    expect(estimateStripeFeeCents(4999)).toBe(250); // ceil(219.956)=220 + 30
  });
});

describe('validateShare', () => {
  it('accepts a profitable share', () => {
    expect(validateShare(5000, { kind: 'bps', bps: 7000 })).toEqual({ ok: true });
  });
  it('rejects share equal to price', () => {
    expect(validateShare(5000, { kind: 'fixed', cents: 5000 }))
      .toEqual({ ok: false, error: 'share_not_below_price' });
  });
  it('rejects share that leaves agency negative after estimated fee', () => {
    // 5000 - 4800 - 250 = -50
    expect(validateShare(5000, { kind: 'fixed', cents: 4800 }))
      .toEqual({ ok: false, error: 'agency_negative_after_fee' });
  });
  it('rejects exactly zero remainder (must be > 0)', () => {
    expect(validateShare(5000, { kind: 'fixed', cents: 4750 }))
      .toEqual({ ok: false, error: 'agency_negative_after_fee' });
  });
  it('rejects bad inputs', () => {
    expect(validateShare(0, { kind: 'bps', bps: 5000 })).toEqual({ ok: false, error: 'invalid_price' });
    expect(validateShare(5000, { kind: 'bps', bps: 10001 })).toEqual({ ok: false, error: 'invalid_share' });
    expect(validateShare(5000, { kind: 'fixed', cents: -1 })).toEqual({ ok: false, error: 'invalid_share' });
    expect(validateShare(5000.5, { kind: 'bps', bps: 5000 })).toEqual({ ok: false, error: 'invalid_price' });
  });
});

describe('agencyRemainderCents (spec 7-7)', () => {
  it('example A: completed session', () => {
    expect(agencyRemainderCents({ amountCents: 5000, refundedCents: 0, feeCents: 175, doctorEntriesCents: 3500 }))
      .toBe(1325);
  });
  it('example B: full refund keeps the fee → negative', () => {
    expect(agencyRemainderCents({ amountCents: 5000, refundedCents: 5000, feeCents: 175, doctorEntriesCents: 0 }))
      .toBe(-175);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/domain/money.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/domain/money.ts`:
```ts
import type { Share } from './types';

const isCents = (n: number) => Number.isInteger(n) && n >= 0;

export function computeShareCents(priceCents: number, share: Share): number {
  if (share.kind === 'fixed') return share.cents;
  return Math.round((priceCents * share.bps) / 10_000);
}

export function estimateStripeFeeCents(priceCents: number): number {
  return Math.ceil(priceCents * 0.044) + 30;
}

export function validateShare(
  priceCents: number,
  share: Share,
):
  | { ok: true }
  | { ok: false; error: 'invalid_price' | 'invalid_share' | 'share_not_below_price' | 'agency_negative_after_fee' } {
  if (!isCents(priceCents) || priceCents === 0) return { ok: false, error: 'invalid_price' };
  if (share.kind === 'bps' && (!Number.isInteger(share.bps) || share.bps < 0 || share.bps > 10_000)) {
    return { ok: false, error: 'invalid_share' };
  }
  if (share.kind === 'fixed' && !isCents(share.cents)) return { ok: false, error: 'invalid_share' };

  const shareCents = computeShareCents(priceCents, share);
  if (shareCents >= priceCents) return { ok: false, error: 'share_not_below_price' };
  if (priceCents - shareCents - estimateStripeFeeCents(priceCents) <= 0) {
    return { ok: false, error: 'agency_negative_after_fee' };
  }
  return { ok: true };
}

export function agencyRemainderCents(p: {
  amountCents: number;
  refundedCents: number;
  feeCents: number;
  doctorEntriesCents: number;
}): number {
  return p.amountCents - p.refundedCents - p.feeCents - p.doctorEntriesCents;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/money.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/money.ts tests/domain/money.test.ts
git commit -m "feat(domain): doctor share, share validation, agency remainder"
```

---

### Task 3: Weekly rules → bookable slots

**Files:**
- Create: `src/domain/slots.ts`
- Test: `tests/domain/slots.test.ts`

**Interfaces:**
- Consumes: `Interval`, `MINUTE`, `HOUR`, `DAY` from `types.ts`.
- Produces:
  - `type WeeklyRule = { weekday: number; start: string; end: string }` — `"HH:MM"`, end may be `"24:00"`.
  - `type SlotOptions = { sessionMinutes: number; bufferMinutes: number; minLeadHours: number; maxHorizonDays: number }`
  - `type Slot = { startsAt: Date; endsAt: Date; blockedUntil: Date }`
  - `generateSlots(input: { rules: WeeklyRule[]; timeOff: Interval[]; busy: Interval[]; options: SlotOptions; now: Date }): Slot[]` — sorted by `startsAt`.
  - `export const TEHRAN = 'Asia/Tehran'`

Rules (spec 4-5): grid starts at the rule's start and steps by `session + buffer`; the **session** must fit inside the rule; the buffer may overflow the rule end; a slot is dropped if `[startsAt, blockedUntil)` overlaps any `timeOff` or `busy` interval; dropped if `startsAt < now + minLead` or `startsAt > now + maxHorizon`.

- [ ] **Step 1: Write failing tests**

`tests/domain/slots.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { generateSlots, TEHRAN, type SlotOptions } from '@/domain/slots';

const opts: SlotOptions = { sessionMinutes: 50, bufferMinutes: 10, minLeadHours: 12, maxHorizonDays: 30 };
const tehran = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(new TZDate(y, m - 1, d, h, min, TEHRAN).getTime());

// 2026-10-24 and 2026-10-31 are Saturdays (weekday 6).
const now = new Date('2026-10-20T00:00:00Z');

describe('generateSlots', () => {
  it('builds a grid of session+buffer steps inside the rule', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    expect(slots.map(s => s.startsAt)).toEqual([
      tehran(2026, 10, 24, 18), tehran(2026, 10, 24, 19), tehran(2026, 10, 24, 20),
    ]);
    expect(slots[0]!.endsAt).toEqual(tehran(2026, 10, 24, 18, 50));
    expect(slots[0]!.blockedUntil).toEqual(tehran(2026, 10, 24, 19, 0));
  });

  it('session must fit, buffer may overflow the rule end', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '19:50' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    // 18:00 (ends 18:50) and 19:00 (ends 19:50, buffer to 20:00 overflows) both fit
    expect(slots).toHaveLength(2);
  });

  it('handles a rule ending at 24:00 (Review Focus 1)', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '22:00', end: '24:00' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    expect(slots.map(s => s.startsAt)).toEqual([tehran(2026, 10, 24, 22), tehran(2026, 10, 24, 23)]);
  });

  it('London display shifts across UK DST end, Tehran stays fixed (spec 8-3)', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '21:00', end: '22:00' }],
      timeOff: [], busy: [], options: opts, now,
    });
    const oct24 = slots.find(s => s.startsAt.getTime() === tehran(2026, 10, 24, 21).getTime())!;
    const oct31 = slots.find(s => s.startsAt.getTime() === tehran(2026, 10, 31, 21).getTime())!;
    expect(new TZDate(oct24.startsAt, TEHRAN).getHours()).toBe(21);
    expect(new TZDate(oct31.startsAt, TEHRAN).getHours()).toBe(21);
    const london24 = new TZDate(oct24.startsAt, 'Europe/London');
    const london31 = new TZDate(oct31.startsAt, 'Europe/London');
    expect([london24.getHours(), london24.getMinutes()]).toEqual([18, 30]); // BST
    expect([london31.getHours(), london31.getMinutes()]).toEqual([17, 30]); // GMT
  });

  it('drops slots overlapping busy intervals, half-open', () => {
    const busy = [{ start: tehran(2026, 10, 24, 19), end: tehran(2026, 10, 24, 20) }];
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy, options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    // 18:00 blocks until 19:00 exactly → allowed (half-open); 19:00 dropped; 20:00 allowed
    expect(slots.map(s => s.startsAt)).toEqual([tehran(2026, 10, 24, 18), tehran(2026, 10, 24, 20)]);
  });

  it('drops slots overlapping time off', () => {
    const timeOff = [{ start: tehran(2026, 10, 24, 0), end: tehran(2026, 10, 25, 0) }];
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff, busy: [], options: opts, now,
    });
    expect(slots.some(s => s.startsAt < new Date('2026-10-25T00:00:00Z'))).toBe(false);
  });

  it('respects min lead and max horizon', () => {
    const lateNow = new Date(tehran(2026, 10, 24, 8).getTime()); // 10h before 18:00
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy: [], options: opts, now: lateNow,
    });
    expect(slots[0]!.startsAt).toEqual(tehran(2026, 10, 24, 20)); // 18:00 & 19:00 are < 12h away
    const last = slots[slots.length - 1]!;
    expect(last.startsAt.getTime()).toBeLessThanOrEqual(lateNow.getTime() + 30 * 24 * 3600_000);
  });

  it('returns slots sorted', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '20:00', end: '21:00' }, { weekday: 6, start: '18:00', end: '19:00' }],
      timeOff: [], busy: [], options: opts, now,
    });
    const times = slots.map(s => s.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/domain/slots.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/domain/slots.ts`:
```ts
import { TZDate } from '@date-fns/tz';
import { DAY, HOUR, MINUTE, type Interval } from './types';

export const TEHRAN = 'Asia/Tehran';

export type WeeklyRule = { weekday: number; start: string; end: string };
export type SlotOptions = {
  sessionMinutes: number;
  bufferMinutes: number;
  minLeadHours: number;
  maxHorizonDays: number;
};
export type Slot = { startsAt: Date; endsAt: Date; blockedUntil: Date };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function generateSlots(input: {
  rules: WeeklyRule[];
  timeOff: Interval[];
  busy: Interval[];
  options: SlotOptions;
  now: Date;
}): Slot[] {
  const { rules, timeOff, busy, options, now } = input;
  const earliest = now.getTime() + options.minLeadHours * HOUR;
  const latest = now.getTime() + options.maxHorizonDays * DAY;
  const sessionMs = options.sessionMinutes * MINUTE;
  const stepMs = (options.sessionMinutes + options.bufferMinutes) * MINUTE;
  const blocked = [...timeOff, ...busy];
  const out: Slot[] = [];

  const first = new TZDate(now, TEHRAN);
  for (let i = 0; i <= options.maxHorizonDays + 1; i++) {
    const day = new TZDate(first.getFullYear(), first.getMonth(), first.getDate() + i, TEHRAN);
    const weekday = day.getDay();
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      const ruleStart = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(rule.start), TEHRAN).getTime();
      const ruleEnd = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(rule.end), TEHRAN).getTime();
      for (let s = ruleStart; s + sessionMs <= ruleEnd; s += stepMs) {
        if (s < earliest || s > latest) continue;
        const slot: Slot = {
          startsAt: new Date(s),
          endsAt: new Date(s + sessionMs),
          blockedUntil: new Date(s + stepMs),
        };
        const range = { start: slot.startsAt, end: slot.blockedUntil };
        if (blocked.some(b => overlaps(range, b))) continue;
        out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/slots.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/slots.ts tests/domain/slots.test.ts
git commit -m "feat(domain): weekly rules to bookable slots in Tehran time"
```

---

### Task 4: Booking rules, cancellation table, reminder schedule

**Files:**
- Create: `src/domain/booking-rules.ts`, `src/domain/cancellation.ts`
- Test: `tests/domain/booking-rules.test.ts`, `tests/domain/cancellation.test.ts`

**Interfaces:**
- Consumes: `HOUR`, `DAY` from `types.ts`.
- Produces:
  - `checkBookable(startsAt: Date, now: Date, r: { minLeadHours: number; maxHorizonDays: number }): { ok: true } | { ok: false; error: 'too_soon' | 'too_far' }`
  - `needsNonrefundableAck(startsAt: Date, now: Date, refundWindowHours: number): boolean`
  - `plannedReminders(startsAt: Date, now: Date): { kind: '24h' | '1h'; at: Date }[]`
  - `type CancelActor = 'client' | 'doctor' | 'admin'`
  - `decideCancellation(i: { actor: CancelActor; startsAt: Date; now: Date; refundWindowHours: number }): CancelDecision` where
    `type CancelDecision = { ok: false; error: 'already_started' } | { ok: true; sessionStatus: 'void'; refund: 'full' | 'none' | 'client_choice'; ledgerType: 'late_cancel_earning' | null }`

Rules: client ≥ 24 h before → full refund, no ledger; client < 24 h → none + `late_cancel_earning`; doctor or admin → `client_choice` (refund or free reschedule), no ledger; at/after `startsAt` → not allowed (spec 4-8: after start only attendance/admin decides).

- [ ] **Step 1: Write failing tests**

`tests/domain/booking-rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { checkBookable, needsNonrefundableAck, plannedReminders } from '@/domain/booking-rules';

const now = new Date('2026-10-20T12:00:00Z');
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
const r = { minLeadHours: 12, maxHorizonDays: 30 };

describe('checkBookable', () => {
  it('rejects under 12h', () => expect(checkBookable(h(11.9), now, r)).toEqual({ ok: false, error: 'too_soon' }));
  it('accepts exactly 12h', () => expect(checkBookable(h(12), now, r)).toEqual({ ok: true }));
  it('accepts exactly 30 days', () => expect(checkBookable(h(720), now, r)).toEqual({ ok: true }));
  it('rejects over 30 days', () => expect(checkBookable(h(720.1), now, r)).toEqual({ ok: false, error: 'too_far' }));
});

describe('needsNonrefundableAck', () => {
  it('true between 12h and 24h', () => expect(needsNonrefundableAck(h(18), now, 24)).toBe(true));
  it('false at exactly 24h', () => expect(needsNonrefundableAck(h(24), now, 24)).toBe(false));
  it('false beyond 24h', () => expect(needsNonrefundableAck(h(30), now, 24)).toBe(false));
});

describe('plannedReminders', () => {
  it('both reminders when far away', () => {
    expect(plannedReminders(h(48), now).map(x => x.kind)).toEqual(['24h', '1h']);
    expect(plannedReminders(h(48), now)[0]!.at).toEqual(h(24));
  });
  it('skips 24h reminder already in the past', () => {
    expect(plannedReminders(h(15), now).map(x => x.kind)).toEqual(['1h']);
  });
  it('no reminders when start is within an hour', () => {
    expect(plannedReminders(h(0.5), now)).toEqual([]);
  });
});
```

`tests/domain/cancellation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decideCancellation } from '@/domain/cancellation';

const now = new Date('2026-10-20T12:00:00Z');
const h = (n: number) => new Date(now.getTime() + n * 3600_000);

describe('decideCancellation', () => {
  it('client ≥24h → full refund, no ledger', () => {
    expect(decideCancellation({ actor: 'client', startsAt: h(24), now, refundWindowHours: 24 }))
      .toEqual({ ok: true, sessionStatus: 'void', refund: 'full', ledgerType: null });
  });
  it('client <24h → no refund, late cancel earning', () => {
    expect(decideCancellation({ actor: 'client', startsAt: h(23.9), now, refundWindowHours: 24 }))
      .toEqual({ ok: true, sessionStatus: 'void', refund: 'none', ledgerType: 'late_cancel_earning' });
  });
  it('doctor any time before start → client chooses, no ledger', () => {
    expect(decideCancellation({ actor: 'doctor', startsAt: h(1), now, refundWindowHours: 24 }))
      .toEqual({ ok: true, sessionStatus: 'void', refund: 'client_choice', ledgerType: null });
  });
  it('admin cancel behaves like doctor cancel', () => {
    expect(decideCancellation({ actor: 'admin', startsAt: h(2), now, refundWindowHours: 24 }))
      .toEqual({ ok: true, sessionStatus: 'void', refund: 'client_choice', ledgerType: null });
  });
  it('not allowed at or after start', () => {
    expect(decideCancellation({ actor: 'client', startsAt: now, now, refundWindowHours: 24 }))
      .toEqual({ ok: false, error: 'already_started' });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run tests/domain/booking-rules.test.ts tests/domain/cancellation.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/booking-rules.ts`:
```ts
import { DAY, HOUR } from './types';

export function checkBookable(
  startsAt: Date,
  now: Date,
  r: { minLeadHours: number; maxHorizonDays: number },
): { ok: true } | { ok: false; error: 'too_soon' | 'too_far' } {
  const diff = startsAt.getTime() - now.getTime();
  if (diff < r.minLeadHours * HOUR) return { ok: false, error: 'too_soon' };
  if (diff > r.maxHorizonDays * DAY) return { ok: false, error: 'too_far' };
  return { ok: true };
}

export function needsNonrefundableAck(startsAt: Date, now: Date, refundWindowHours: number): boolean {
  return startsAt.getTime() - now.getTime() < refundWindowHours * HOUR;
}

export function plannedReminders(startsAt: Date, now: Date): { kind: '24h' | '1h'; at: Date }[] {
  const all = [
    { kind: '24h' as const, at: new Date(startsAt.getTime() - 24 * HOUR) },
    { kind: '1h' as const, at: new Date(startsAt.getTime() - HOUR) },
  ];
  return all.filter(r => r.at.getTime() > now.getTime());
}
```

`src/domain/cancellation.ts`:
```ts
import { HOUR } from './types';

export type CancelActor = 'client' | 'doctor' | 'admin';
export type CancelDecision =
  | { ok: false; error: 'already_started' }
  | {
      ok: true;
      sessionStatus: 'void';
      refund: 'full' | 'none' | 'client_choice';
      ledgerType: 'late_cancel_earning' | null;
    };

export function decideCancellation(i: {
  actor: CancelActor;
  startsAt: Date;
  now: Date;
  refundWindowHours: number;
}): CancelDecision {
  if (i.now.getTime() >= i.startsAt.getTime()) return { ok: false, error: 'already_started' };
  if (i.actor !== 'client') {
    return { ok: true, sessionStatus: 'void', refund: 'client_choice', ledgerType: null };
  }
  const early = i.startsAt.getTime() - i.now.getTime() >= i.refundWindowHours * HOUR;
  return early
    ? { ok: true, sessionStatus: 'void', refund: 'full', ledgerType: null }
    : { ok: true, sessionStatus: 'void', refund: 'none', ledgerType: 'late_cancel_earning' };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/booking-rules.test.ts tests/domain/cancellation.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/booking-rules.ts src/domain/cancellation.ts tests/domain/booking-rules.test.ts tests/domain/cancellation.test.ts
git commit -m "feat(domain): booking lead/horizon, non-refundable ack, reminders, cancellation table"
```

---

### Task 5: Attendance and session judgement

**Files:**
- Create: `src/domain/attendance.ts`
- Test: `tests/domain/attendance.test.ts`

**Interfaces:**
- Consumes: `Interval`, `SessionStatus`, `MINUTE` from `types.ts`.
- Produces:
  - `type PresenceEvent = { profileId: string; type: 'joined' | 'left'; at: Date }`
  - `presenceIntervals(events: PresenceEvent[], profileId: string, window: Interval): Interval[]` — sorted, merged, clipped to window; unmatched `joined` closes at `window.end`; total < 60 s → `[]`.
  - `totalMs(intervals: Interval[]): number`
  - `overlapMs(a: Interval[], b: Interval[]): number`
  - `type JudgeConfig = { thresholdRatio: number; waitMinutes: number; toleranceMinutes: number; graceAfterEndMinutes: number }`
  - `export const DEFAULT_JUDGE: JudgeConfig = { thresholdRatio: 0.5, waitMinutes: 15, toleranceMinutes: 2, graceAfterEndMinutes: 10 }`
  - `judgeSession(i: { startsAt: Date; endsAt: Date; clientId: string; doctorId: string; events: PresenceEvent[]; hasOpenDispute: boolean; hasConnectionIssue: boolean; config?: JudgeConfig }): { status: Exclude<SessionStatus, 'scheduled' | 'void'>; overlapMs: number }`

Judgement order (spec 4-8): 1 dispute → `needs_review`; 2 overlap ≥ threshold → `completed`; 3 connection issue + both present + overlap < threshold → `partial`; 4 client absent + doctor present ≥ (wait − tolerance) inside `[start, start + wait]` → `no_show_client`; 5 mirror → `no_show_doctor`; 6 else `needs_review`.

- [ ] **Step 1: Write failing tests**

`tests/domain/attendance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { judgeSession, presenceIntervals, totalMs, type PresenceEvent } from '@/domain/attendance';

const start = new Date('2026-10-24T17:30:00Z');
const end = new Date('2026-10-24T18:20:00Z'); // 50 min
const m = (min: number) => new Date(start.getTime() + min * 60_000);
const C = 'client', D = 'doctor';
const ev = (profileId: string, type: 'joined' | 'left', min: number): PresenceEvent => ({ profileId, type, at: m(min) });
const base = { startsAt: start, endsAt: end, clientId: C, doctorId: D, hasOpenDispute: false, hasConnectionIssue: false };
const window = { start, end: new Date(end.getTime() + 10 * 60_000) };

describe('presenceIntervals', () => {
  it('clips waiting-room time before start', () => {
    const iv = presenceIntervals([ev(D, 'joined', -5), ev(D, 'left', 30)], D, window);
    expect(totalMs(iv)).toBe(30 * 60_000);
  });
  it('unmatched join closes at window end', () => {
    const iv = presenceIntervals([ev(D, 'joined', 0)], D, window);
    expect(totalMs(iv)).toBe(60 * 60_000);
  });
  it('merges duplicate joins and out-of-order events (Review Focus 2)', () => {
    const events = [ev(D, 'left', 40), ev(D, 'joined', 10), ev(D, 'joined', 0), ev(D, 'left', 20)];
    // sorted: join0, join10, left20, left40 → open from 0 until both tabs left at 40
    const iv = presenceIntervals(events, D, window);
    expect(totalMs(iv)).toBe(40 * 60_000);
  });
  it('under 60s total counts as absent', () => {
    const iv = presenceIntervals([ev(D, 'joined', 0), { profileId: D, type: 'left', at: new Date(m(0).getTime() + 59_000) }], D, window);
    expect(iv).toEqual([]);
  });
});

describe('judgeSession (spec 4-8 order)', () => {
  const full = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 50), ev(D, 'left', 50)];

  it('open dispute wins over everything', () => {
    expect(judgeSession({ ...base, events: full, hasOpenDispute: true }).status).toBe('needs_review');
  });
  it('overlap ≥ 50% → completed', () => {
    expect(judgeSession({ ...base, events: full }).status).toBe('completed');
  });
  it('example D: connection button but 40 min overlap → still completed', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 40), ev(D, 'left', 40)];
    expect(judgeSession({ ...base, events, hasConnectionIssue: true }).status).toBe('completed');
  });
  it('example C: 10 min overlap + connection report → partial', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 10), ev(D, 'left', 30)];
    const r = judgeSession({ ...base, events, hasConnectionIssue: true });
    expect(r.status).toBe('partial');
    expect(r.overlapMs).toBe(10 * 60_000);
  });
  it('short overlap without connection report → needs_review', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 10), ev(D, 'left', 30)];
    expect(judgeSession({ ...base, events }).status).toBe('needs_review');
  });
  it('client never came, doctor waited 13 of 15 min → no_show_client', () => {
    const events = [ev(D, 'joined', 2), ev(D, 'left', 15)];
    expect(judgeSession({ ...base, events }).status).toBe('no_show_client');
  });
  it('doctor waited only 10 min → needs_review', () => {
    const events = [ev(D, 'joined', 0), ev(D, 'left', 10)];
    expect(judgeSession({ ...base, events }).status).toBe('needs_review');
  });
  it('doctor never came, client waited → no_show_doctor', () => {
    const events = [ev(C, 'joined', 0), ev(C, 'left', 20)];
    expect(judgeSession({ ...base, events }).status).toBe('no_show_doctor');
  });
  it('late client who finally joins is not a no-show', () => {
    const events = [ev(D, 'joined', 0), ev(C, 'joined', 20), ev(C, 'left', 50), ev(D, 'left', 50)];
    expect(judgeSession({ ...base, events }).status).toBe('completed'); // 30 min overlap ≥ 25
  });
  it('nobody came → needs_review', () => {
    expect(judgeSession({ ...base, events: [] }).status).toBe('needs_review');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/domain/attendance.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/attendance.ts`:
```ts
import { MINUTE, type Interval, type SessionStatus } from './types';

export type PresenceEvent = { profileId: string; type: 'joined' | 'left'; at: Date };
export type JudgeConfig = {
  thresholdRatio: number;
  waitMinutes: number;
  toleranceMinutes: number;
  graceAfterEndMinutes: number;
};
export const DEFAULT_JUDGE: JudgeConfig = {
  thresholdRatio: 0.5,
  waitMinutes: 15,
  toleranceMinutes: 2,
  graceAfterEndMinutes: 10,
};

const MIN_PRESENCE_MS = 60_000;

export function totalMs(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end.getTime() - i.start.getTime()), 0);
}

function clip(intervals: Interval[], w: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of intervals) {
    const s = Math.max(i.start.getTime(), w.start.getTime());
    const e = Math.min(i.end.getTime(), w.end.getTime());
    if (e > s) out.push({ start: new Date(s), end: new Date(e) });
  }
  return out;
}

export function presenceIntervals(events: PresenceEvent[], profileId: string, window: Interval): Interval[] {
  const mine = events
    .filter(e => e.profileId === profileId)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.type === 'joined' ? -1 : 1));
  const raw: Interval[] = [];
  let open = 0;
  let openedAt: Date | null = null;
  for (const e of mine) {
    if (e.type === 'joined') {
      if (open === 0) openedAt = e.at;
      open++;
    } else if (open > 0) {
      open--;
      if (open === 0 && openedAt) {
        raw.push({ start: openedAt, end: e.at });
        openedAt = null;
      }
    }
  }
  if (open > 0 && openedAt) raw.push({ start: openedAt, end: window.end });
  const clipped = clip(raw, window);
  return totalMs(clipped) < MIN_PRESENCE_MS ? [] : clipped;
}

export function overlapMs(a: Interval[], b: Interval[]): number {
  let sum = 0;
  for (const x of a) {
    for (const y of b) {
      const s = Math.max(x.start.getTime(), y.start.getTime());
      const e = Math.min(x.end.getTime(), y.end.getTime());
      if (e > s) sum += e - s;
    }
  }
  return sum;
}

export function judgeSession(i: {
  startsAt: Date;
  endsAt: Date;
  clientId: string;
  doctorId: string;
  events: PresenceEvent[];
  hasOpenDispute: boolean;
  hasConnectionIssue: boolean;
  config?: JudgeConfig;
}): { status: Exclude<SessionStatus, 'scheduled' | 'void'>; overlapMs: number } {
  const c = i.config ?? DEFAULT_JUDGE;
  const window = { start: i.startsAt, end: new Date(i.endsAt.getTime() + c.graceAfterEndMinutes * MINUTE) };
  const client = presenceIntervals(i.events, i.clientId, window);
  const doctor = presenceIntervals(i.events, i.doctorId, window);
  const overlap = overlapMs(client, doctor);
  const threshold = (i.endsAt.getTime() - i.startsAt.getTime()) * c.thresholdRatio;

  const wait = { start: i.startsAt, end: new Date(i.startsAt.getTime() + c.waitMinutes * MINUTE) };
  const waitedEnough = (iv: Interval[]) =>
    totalMs(clip(iv, wait)) >= (c.waitMinutes - c.toleranceMinutes) * MINUTE;

  let status: Exclude<SessionStatus, 'scheduled' | 'void'>;
  if (i.hasOpenDispute) status = 'needs_review';
  else if (overlap >= threshold) status = 'completed';
  else if (i.hasConnectionIssue && client.length > 0 && doctor.length > 0) status = 'partial';
  else if (client.length === 0 && waitedEnough(doctor)) status = 'no_show_client';
  else if (doctor.length === 0 && waitedEnough(client)) status = 'no_show_doctor';
  else status = 'needs_review';
  return { status, overlapMs: overlap };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/attendance.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/attendance.ts tests/domain/attendance.test.ts
git commit -m "feat(domain): presence intervals and session judgement order"
```

---

### Task 6: Doctor ledger — balance, ready-to-pay, allocation, entry status

**Files:**
- Create: `src/domain/ledger.ts`
- Test: `tests/domain/ledger.test.ts`

**Interfaces:**
- Consumes: `LedgerEntry`, `Settlement`, `Allocation`, `SessionStatus`, `HOUR` from `types.ts`.
- Produces:
  - `balanceCents(entries: LedgerEntry[], settlements: Settlement[]): number` — Σentries − Σsettlements.
  - `type BookingMeta = { endsAt: Date; sessionStatus: SessionStatus; reviewDecidedAt: Date | null }`
  - `readyToPayCents(i: { entries: LedgerEntry[]; settlements: Settlement[]; bookings: Map<string, BookingMeta>; now: Date; delayHours?: number }): number` — positive booking entries count only when `now ≥ max(endsAt, reviewDecidedAt) + 24h` and status ≠ `needs_review`; entries without booking and all negative entries count immediately; result floored at 0.
  - `allocate(i: { settlementId: string; amountCents: number; entries: LedgerEntry[]; existing: Allocation[] }): Allocation[]` — FIFO over positive entries by `createdAt`, capacity = amount − already allocated; total ≤ `amountCents`.
  - `entryStatus(entry: LedgerEntry, allocations: Allocation[]): 'payable' | 'partially_settled' | 'settled'`
  - `nextSourceKey` is NOT here — keys are built by callers as `booking:{id}:auto`, `booking:{id}:late_cancel`, `refund:{id}:reversal`.

- [ ] **Step 1: Write failing tests**

`tests/domain/ledger.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { allocate, balanceCents, entryStatus, readyToPayCents, type BookingMeta } from '@/domain/ledger';
import type { LedgerEntry, Settlement } from '@/domain/types';

const T0 = new Date('2026-10-24T18:20:00Z'); // session end
const hrs = (n: number) => new Date(T0.getTime() + n * 3600_000);
const entry = (id: string, amountCents: number, createdAt = T0, bookingId: string | null = 'b1', type: LedgerEntry['type'] = 'session_earning'): LedgerEntry =>
  ({ id, doctorId: 'd1', bookingId, type, amountCents, sourceKey: `k-${id}`, createdAt });
const settle = (id: string, amountCents: number): Settlement => ({ id, doctorId: 'd1', amountCents, paidAt: hrs(30) });
const meta = (status: BookingMeta['sessionStatus'] = 'completed', reviewDecidedAt: Date | null = null) =>
  new Map<string, BookingMeta>([['b1', { endsAt: T0, sessionStatus: status, reviewDecidedAt }]]);

describe('example A: completed session', () => {
  const entries = [entry('e1', 3500)];
  it('ready to pay is 0 within 24h', () => {
    expect(readyToPayCents({ entries, settlements: [], bookings: meta(), now: hrs(23) })).toBe(0);
  });
  it('ready to pay is 3500 after 24h', () => {
    expect(readyToPayCents({ entries, settlements: [], bookings: meta(), now: hrs(24) })).toBe(3500);
  });
  it('settling 3500 zeroes the balance', () => {
    expect(balanceCents(entries, [settle('s1', 3500)])).toBe(0);
  });
});

describe('example D: review request blocks ready-to-pay', () => {
  it('needs_review entry is not payable', () => {
    expect(readyToPayCents({ entries: [entry('e1', 3500)], settlements: [], bookings: meta('needs_review'), now: hrs(48) })).toBe(0);
  });
  it('24h restarts from admin decision', () => {
    const b = meta('completed', hrs(30));
    expect(readyToPayCents({ entries: [entry('e1', 3500)], settlements: [], bookings: b, now: hrs(50) })).toBe(0);
    expect(readyToPayCents({ entries: [entry('e1', 3500)], settlements: [], bookings: b, now: hrs(54) })).toBe(3500);
  });
});

describe('example E: settled then reversed', () => {
  it('balance goes to -3500', () => {
    const entries = [entry('e1', 3500), entry('e2', -3500, hrs(40), 'b1', 'reversal')];
    expect(balanceCents(entries, [settle('s1', 3500)])).toBe(-3500);
  });
  it('negative entries count immediately, ready-to-pay floors at 0', () => {
    const entries = [entry('e1', 3500), entry('e2', -3500, hrs(40), 'b1', 'reversal')];
    expect(readyToPayCents({ entries, settlements: [settle('s1', 3500)], bookings: meta(), now: hrs(41) })).toBe(0);
  });
});

describe('allocate', () => {
  it('FIFO across entries', () => {
    const entries = [entry('e1', 3500, hrs(0)), entry('e2', 3500, hrs(1))];
    expect(allocate({ settlementId: 's1', amountCents: 5000, entries, existing: [] })).toEqual([
      { settlementId: 's1', ledgerEntryId: 'e1', amountCents: 3500 },
      { settlementId: 's1', ledgerEntryId: 'e2', amountCents: 1500 },
    ]);
  });
  it('respects existing allocations', () => {
    const entries = [entry('e1', 3500, hrs(0)), entry('e2', 3500, hrs(1))];
    const existing = [{ settlementId: 's0', ledgerEntryId: 'e1', amountCents: 3500 }];
    expect(allocate({ settlementId: 's1', amountCents: 1000, entries, existing })).toEqual([
      { settlementId: 's1', ledgerEntryId: 'e2', amountCents: 1000 },
    ]);
  });
  it('overpayment: never allocates beyond capacity, balance negative (Review Focus 3)', () => {
    const entries = [entry('e1', 3500)];
    const allocs = allocate({ settlementId: 's1', amountCents: 5000, entries, existing: [] });
    expect(allocs).toEqual([{ settlementId: 's1', ledgerEntryId: 'e1', amountCents: 3500 }]);
    expect(balanceCents(entries, [settle('s1', 5000)])).toBe(-1500);
  });
  it('ignores negative entries', () => {
    const entries = [entry('e1', -500, hrs(0), null, 'adjustment'), entry('e2', 3500, hrs(1))];
    expect(allocate({ settlementId: 's1', amountCents: 3500, entries, existing: [] })).toEqual([
      { settlementId: 's1', ledgerEntryId: 'e2', amountCents: 3500 },
    ]);
  });
});

describe('entryStatus', () => {
  const e = entry('e1', 3500);
  it('payable / partial / settled', () => {
    expect(entryStatus(e, [])).toBe('payable');
    expect(entryStatus(e, [{ settlementId: 's', ledgerEntryId: 'e1', amountCents: 1000 }])).toBe('partially_settled');
    expect(entryStatus(e, [{ settlementId: 's', ledgerEntryId: 'e1', amountCents: 3500 }])).toBe('settled');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/domain/ledger.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/ledger.ts`:
```ts
import { HOUR, type Allocation, type LedgerEntry, type SessionStatus, type Settlement } from './types';

export type BookingMeta = { endsAt: Date; sessionStatus: SessionStatus; reviewDecidedAt: Date | null };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function balanceCents(entries: LedgerEntry[], settlements: Settlement[]): number {
  return sum(entries.map(e => e.amountCents)) - sum(settlements.map(s => s.amountCents));
}

export function readyToPayCents(i: {
  entries: LedgerEntry[];
  settlements: Settlement[];
  bookings: Map<string, BookingMeta>;
  now: Date;
  delayHours?: number;
}): number {
  const delay = (i.delayHours ?? 24) * HOUR;
  let eligible = 0;
  for (const e of i.entries) {
    if (e.amountCents <= 0 || e.bookingId === null) {
      eligible += e.amountCents;
      continue;
    }
    const b = i.bookings.get(e.bookingId);
    if (!b || b.sessionStatus === 'needs_review') continue;
    const from = Math.max(b.endsAt.getTime(), b.reviewDecidedAt?.getTime() ?? 0);
    if (i.now.getTime() >= from + delay) eligible += e.amountCents;
  }
  return Math.max(0, eligible - sum(i.settlements.map(s => s.amountCents)));
}

export function allocate(i: {
  settlementId: string;
  amountCents: number;
  entries: LedgerEntry[];
  existing: Allocation[];
}): Allocation[] {
  const used = new Map<string, number>();
  for (const a of i.existing) used.set(a.ledgerEntryId, (used.get(a.ledgerEntryId) ?? 0) + a.amountCents);
  const positives = i.entries
    .filter(e => e.amountCents > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let left = i.amountCents;
  const out: Allocation[] = [];
  for (const e of positives) {
    if (left <= 0) break;
    const capacity = e.amountCents - (used.get(e.id) ?? 0);
    if (capacity <= 0) continue;
    const take = Math.min(capacity, left);
    out.push({ settlementId: i.settlementId, ledgerEntryId: e.id, amountCents: take });
    left -= take;
  }
  return out;
}

export function entryStatus(entry: LedgerEntry, allocations: Allocation[]): 'payable' | 'partially_settled' | 'settled' {
  const covered = sum(allocations.filter(a => a.ledgerEntryId === entry.id).map(a => a.amountCents));
  if (covered <= 0) return 'payable';
  return covered >= entry.amountCents ? 'settled' : 'partially_settled';
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/domain/ledger.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/ledger.ts tests/domain/ledger.test.ts
git commit -m "feat(domain): doctor ledger balance, ready-to-pay, FIFO allocation"
```

---

### Task 7: Doctor matching for the questionnaire

**Files:**
- Create: `src/domain/matching.ts`
- Test: `tests/domain/matching.test.ts`

**Interfaces:**
- Produces:
  - `type DoctorCandidate = { id: string; gender: 'female' | 'male'; specialties: string[]; upcomingSlots: Date[] }`
  - `type MatchNote = 'gender_relaxed' | 'no_specialty_match'`
  - `rankDoctors(i: { doctors: DoctorCandidate[]; topic: string; genderPref: 'female' | 'male' | null; clientTimeZone: string; now: Date; limit?: number }): { doctors: DoctorCandidate[]; notes: MatchNote[] }`

Scoring (spec 8-4): specialty match +10; a slot within 7 days +3; a slot within 7 days in the client's local 17:00–21:00 +2 (score only, never a filter). Gender filter applies only if it leaves ≥ 1 doctor, else note `gender_relaxed`. If no doctor has the topic, note `no_specialty_match` (doctors still returned). Ties keep input order. Default `limit` 3.

- [ ] **Step 1: Write failing tests**

`tests/domain/matching.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { rankDoctors, type DoctorCandidate } from '@/domain/matching';

const now = new Date('2026-10-20T00:00:00Z');
// 2026-10-21 17:30 UTC = 21:00 Tehran = 18:30 London (BST) = 13:30 New York = 23:00 Kolkata
const slot = new Date('2026-10-21T17:30:00Z');
const d = (id: string, gender: 'female' | 'male', specialties: string[], upcomingSlots: Date[] = [slot]): DoctorCandidate =>
  ({ id, gender, specialties, upcomingSlots });

describe('rankDoctors', () => {
  it('ranks specialty matches first', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['sleep']), d('b', 'female', ['anxiety'])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
    expect(r.notes).toEqual([]);
  });

  it('gender with no result relaxes the filter and says so', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'])],
      topic: 'anxiety', genderPref: 'female', clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['a']);
    expect(r.notes).toContain('gender_relaxed');
  });

  it('gender filter applies when it has results', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety']), d('b', 'female', ['sleep'])],
      topic: 'anxiety', genderPref: 'female', clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b']);
  });

  it('US evening mismatch never empties the list', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'America/New_York', now,
    });
    expect(r.doctors).toHaveLength(1);
  });

  it('evening bonus breaks ties in client local time (London 18:30 yes)', () => {
    const noon = new Date('2026-10-21T08:30:00Z'); // 09:30 London
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [noon]), d('b', 'male', ['anxiety'], [slot])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
  });

  it('half-hour timezone uses local clock (Review Focus 5)', () => {
    const kolkataEvening = new Date('2026-10-21T13:00:00Z'); // 18:30 Kolkata
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [slot]), d('b', 'male', ['anxiety'], [kolkataEvening])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Asia/Kolkata', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']); // slot is 23:00 Kolkata → no bonus
  });

  it('no specialty match still returns doctors with a note, limit 3', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['x']), d('b', 'male', ['x']), d('c', 'male', ['x']), d('e', 'male', ['x'])],
      topic: 'grief', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors).toHaveLength(3);
    expect(r.notes).toContain('no_specialty_match');
  });

  it('slots beyond 7 days earn no availability points', () => {
    const far = new Date('2026-10-28T17:30:00Z');
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [far]), d('b', 'male', ['anxiety'], [slot])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/domain/matching.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

`src/domain/matching.ts`:
```ts
import { TZDate } from '@date-fns/tz';
import { DAY } from './types';

export type DoctorCandidate = {
  id: string;
  gender: 'female' | 'male';
  specialties: string[];
  upcomingSlots: Date[];
};
export type MatchNote = 'gender_relaxed' | 'no_specialty_match';

export function rankDoctors(i: {
  doctors: DoctorCandidate[];
  topic: string;
  genderPref: 'female' | 'male' | null;
  clientTimeZone: string;
  now: Date;
  limit?: number;
}): { doctors: DoctorCandidate[]; notes: MatchNote[] } {
  const notes: MatchNote[] = [];
  let pool = i.doctors;
  if (i.genderPref) {
    const filtered = pool.filter(d => d.gender === i.genderPref);
    if (filtered.length > 0) pool = filtered;
    else notes.push('gender_relaxed');
  }
  if (!pool.some(d => d.specialties.includes(i.topic))) notes.push('no_specialty_match');

  const weekEnd = i.now.getTime() + 7 * DAY;
  const isEvening = (t: Date) => {
    const h = new TZDate(t, i.clientTimeZone).getHours();
    return h >= 17 && h < 21;
  };
  const score = (d: DoctorCandidate) => {
    const soon = d.upcomingSlots.filter(s => s.getTime() >= i.now.getTime() && s.getTime() <= weekEnd);
    return (
      (d.specialties.includes(i.topic) ? 10 : 0) +
      (soon.length > 0 ? 3 : 0) +
      (soon.some(isEvening) ? 2 : 0)
    );
  };

  const ranked = pool
    .map((d, idx) => ({ d, idx, s: score(d) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .slice(0, i.limit ?? 3)
    .map(x => x.d);
  return { doctors: ranked, notes };
}
```

- [ ] **Step 4: Run all tests + typecheck**

Run: `npm test && npm run typecheck` → Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/domain/matching.ts tests/domain/matching.test.ts
git commit -m "feat(domain): questionnaire doctor ranking"
```

---

## Self-review notes

- Spec coverage for this plan: shares + fee validation (7-2) → T2; agency remainder incl. refund fee (7-5, 7-7 B) → T2; slots/grid/buffer/time off/lead/horizon/DST (4-5, 8-3) → T3; non-refundable ack, reminders (4-4, 4-6) → T4; cancellation table (4-8) → T4; judgement order, waiting window, <60 s rule, overlap window (4-8) → T5; ledger, ready-to-pay 24 h, review restart, allocation, overpayment (7-3, 7-7 A/D/E) → T6; matching incl. gender relax & evening score (8-4) → T7. Example F (double finalize) is enforced by unique `source_key` in the database → Plan 2.
- Out of this plan by design: SQL functions, RLS, webhooks, video, UI.
