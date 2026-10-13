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
