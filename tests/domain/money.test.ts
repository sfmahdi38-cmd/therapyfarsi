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
