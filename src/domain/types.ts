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
