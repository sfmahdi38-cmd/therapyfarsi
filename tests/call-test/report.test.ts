import { describe, expect, it } from 'vitest';
import { formatDuration, formatReport, summarizeCall, type CallEvent, type CallEventKind } from '@/call-test/report';

const t0 = Date.UTC(2026, 9, 14, 17, 33, 0); // 21:03 Tehran
const s = (n: number) => n * 1000;
const m = (n: number) => n * 60_000;
const ev = (at: number, kind: CallEventKind): CallEvent => ({ at: t0 + at, kind });

describe('summarizeCall', () => {
  it('clean 50-minute call: peer hanging up at the end is not a drop (Review Focus 4)', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(50), 'peer_left'), ev(m(50) + s(10), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ startedAt: t0, durationMs: m(50) + s(10), outages: 0, peerDrops: 0, passed: true });
  });

  it('a short reconnect is counted but passes', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(5), 'reconnected'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, totalOutageMs: s(5), longestOutageMs: s(5), passed: true });
  });

  it('a 45-second outage fails', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(45), 'reconnected'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, longestOutageMs: s(45), passed: false });
  });

  it('left while reconnecting and never came back (Review Focus 3)', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(20), 'reconnecting'), ev(m(21), 'left')], t0 + m(30));
    expect(out).toMatchObject({ durationMs: m(21), outages: 1, longestOutageMs: m(1), passed: false });
  });

  it('dropped out and rejoined: the gap is an outage', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(10), 'left'), ev(m(10) + s(20), 'joined'), ev(m(50), 'left')], t0 + m(60));
    expect(out).toMatchObject({ durationMs: m(50), outages: 1, longestOutageMs: s(20), passed: true });
  });

  it('reconnecting, then left, then rejoined is one outage', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(30), 'left'), ev(m(11), 'joined'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, longestOutageMs: m(1), passed: false });
  });

  it('peer drop and return is counted', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(5), 'peer_left'), ev(m(5) + s(40), 'peer_joined'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ peerDrops: 1, longestPeerGapMs: s(40), passed: false });
  });

  it('ignores reconnected without reconnecting (initial connect events)', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(s(1), 'reconnected'), ev(m(50), 'left')], t0 + m(60));
    expect(out.outages).toBe(0);
  });

  it('measures low quality and audio-only time without double counting', () => {
    const out = summarizeCall([
      ev(0, 'joined'),
      ev(m(5), 'quality_low'), ev(m(6), 'quality_low'), ev(m(8), 'quality_ok'),
      ev(m(10), 'camera_off'), ev(m(12), 'camera_on'),
      ev(m(40), 'camera_off'),
      ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out.lowQualityMs).toBe(m(3));
    expect(out.audioOnlyMs).toBe(m(2) + m(10));
  });

  it('a call still in progress runs to endAt', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(10), 'reconnecting')], t0 + m(10) + s(12));
    expect(out).toMatchObject({ durationMs: m(10) + s(12), outages: 1, longestOutageMs: s(12) });
  });

  it('sorts events and counts errors', () => {
    const out = summarizeCall([ev(m(50), 'left'), ev(m(3), 'error'), ev(0, 'joined')], t0 + m(60));
    expect(out).toMatchObject({ durationMs: m(50), errors: 1 });
  });

  it('never joined: zero duration, not passed', () => {
    expect(summarizeCall([ev(0, 'error')], t0 + m(1))).toMatchObject({ startedAt: null, durationMs: 0, passed: false });
  });
});

describe('formatDuration', () => {
  it('minutes and whole seconds', () => {
    expect(formatDuration(0)).toBe('0m 0s');
    expect(formatDuration(61_500)).toBe('1m 1s');
    expect(formatDuration(m(50) + s(10))).toBe('50m 10s');
  });
});

describe('formatReport', () => {
  it('plain text with Tehran start time, ratings and result', () => {
    const text = formatReport(
      { provider: 'daily', room: 'tehran-1', tester: 'دکتر الف', network: 'mci', device: 'phone', relay: 'forced', audioRating: 4, videoRating: null, notes: 'خوب بود' },
      [ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(50), 'peer_left'), ev(m(50) + s(10), 'left')],
      t0 + m(60),
    );
    expect(text).toContain('provider: daily');
    expect(text).toContain('network: mci');
    expect(text).toContain('relay (TURN 443): forced');
    expect(text).toContain('started (Tehran): 2026-10-14 21:03');
    expect(text).toContain('duration: 50m 10s');
    expect(text).toContain('own outages: 0 (total 0m 0s, longest 0m 0s)');
    expect(text).toContain('audio rating: 4/5');
    expect(text).toContain('video rating: —');
    expect(text).toContain('result: PASS');
    expect(text).toContain('notes: خوب بود');
  });
});
