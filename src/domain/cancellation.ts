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
