import { MINUTE, type Interval, type SessionStatus } from './types';

// connectionId identifies one browser connection (the video provider's
// participant-session id). Events without one share a single connection.
export type PresenceEvent = { profileId: string; type: 'joined' | 'left'; at: Date; connectionId?: string };
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

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start.getTime() <= last.end.getTime()) {
      if (i.end > last.end) last.end = i.end;
    } else {
      out.push({ start: i.start, end: i.end });
    }
  }
  return out;
}

export function presenceIntervals(events: PresenceEvent[], profileId: string, window: Interval): Interval[] {
  const mine = events
    .filter(e => e.profileId === profileId)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.type === 'joined' ? -1 : 1));
  const raw: Interval[] = [];
  const openSince = new Map<string, Date>();
  for (const e of mine) {
    const conn = e.connectionId ?? '';
    const opened = openSince.get(conn);
    if (e.type === 'joined') {
      if (!opened) openSince.set(conn, e.at); // a repeated join on an open connection is a duplicate
    } else if (opened) {
      raw.push({ start: opened, end: e.at });
      openSince.delete(conn);
    }
  }
  for (const opened of openSince.values()) raw.push({ start: opened, end: window.end });
  const clipped = merge(clip(raw, window));
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
