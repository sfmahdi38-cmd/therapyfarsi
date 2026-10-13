import { describe, it, expect } from 'vitest';
import { judgeSession, presenceIntervals, totalMs, type PresenceEvent } from '@/domain/attendance';

const start = new Date('2026-10-24T17:30:00Z');
const end = new Date('2026-10-24T18:20:00Z'); // 50 min
const m = (min: number) => new Date(start.getTime() + min * 60_000);
const C = 'client', D = 'doctor';
const ev = (profileId: string, type: 'joined' | 'left', min: number): PresenceEvent => ({ profileId, type, at: m(min) });
const base = { startsAt: start, endsAt: end, clientId: C, doctorId: D, hasOpenDispute: false, hasConnectionIssue: false };
const window = { start, end: new Date(end.getTime() + 10 * 60_000) };

describe('presenceIntervals', () => {
  it('clips waiting-room time before start', () => {
    const iv = presenceIntervals([ev(D, 'joined', -5), ev(D, 'left', 30)], D, window);
    expect(totalMs(iv)).toBe(30 * 60_000);
  });
  it('unmatched join closes at window end', () => {
    const iv = presenceIntervals([ev(D, 'joined', 0)], D, window);
    expect(totalMs(iv)).toBe(60 * 60_000);
  });
  it('merges duplicate joins and out-of-order events (Review Focus 2)', () => {
    const events = [ev(D, 'left', 40), ev(D, 'joined', 10), ev(D, 'joined', 0), ev(D, 'left', 20)];
    // sorted: join0, join10, left20, left40 → open from 0 until both tabs left at 40
    const iv = presenceIntervals(events, D, window);
    expect(totalMs(iv)).toBe(40 * 60_000);
  });
  it('under 60s total counts as absent', () => {
    const iv = presenceIntervals([ev(D, 'joined', 0), { profileId: D, type: 'left', at: new Date(m(0).getTime() + 59_000) }], D, window);
    expect(iv).toEqual([]);
  });
});

describe('judgeSession (spec 4-8 order)', () => {
  const full = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 50), ev(D, 'left', 50)];

  it('open dispute wins over everything', () => {
    expect(judgeSession({ ...base, events: full, hasOpenDispute: true }).status).toBe('needs_review');
  });
  it('overlap ≥ 50% → completed', () => {
    expect(judgeSession({ ...base, events: full }).status).toBe('completed');
  });
  it('example D: connection button but 40 min overlap → still completed', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 40), ev(D, 'left', 40)];
    expect(judgeSession({ ...base, events, hasConnectionIssue: true }).status).toBe('completed');
  });
  it('example C: 10 min overlap + connection report → partial', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 10), ev(D, 'left', 30)];
    const r = judgeSession({ ...base, events, hasConnectionIssue: true });
    expect(r.status).toBe('partial');
    expect(r.overlapMs).toBe(10 * 60_000);
  });
  it('short overlap without connection report → needs_review', () => {
    const events = [ev(C, 'joined', 0), ev(D, 'joined', 0), ev(C, 'left', 10), ev(D, 'left', 30)];
    expect(judgeSession({ ...base, events }).status).toBe('needs_review');
  });
  it('client never came, doctor waited 13 of 15 min → no_show_client', () => {
    const events = [ev(D, 'joined', 2), ev(D, 'left', 15)];
    expect(judgeSession({ ...base, events }).status).toBe('no_show_client');
  });
  it('doctor waited only 10 min → needs_review', () => {
    const events = [ev(D, 'joined', 0), ev(D, 'left', 10)];
    expect(judgeSession({ ...base, events }).status).toBe('needs_review');
  });
  it('doctor never came, client waited → no_show_doctor', () => {
    const events = [ev(C, 'joined', 0), ev(C, 'left', 20)];
    expect(judgeSession({ ...base, events }).status).toBe('no_show_doctor');
  });
  it('late client who finally joins is not a no-show', () => {
    const events = [ev(D, 'joined', 0), ev(C, 'joined', 20), ev(C, 'left', 50), ev(D, 'left', 50)];
    expect(judgeSession({ ...base, events }).status).toBe('completed'); // 30 min overlap ≥ 25
  });
  it('nobody came → needs_review', () => {
    expect(judgeSession({ ...base, events: [] }).status).toBe('needs_review');
  });
});
