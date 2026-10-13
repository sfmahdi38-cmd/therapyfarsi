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
