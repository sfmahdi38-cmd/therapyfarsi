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
