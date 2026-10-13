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
