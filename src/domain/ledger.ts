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
