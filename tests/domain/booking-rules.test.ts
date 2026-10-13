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
