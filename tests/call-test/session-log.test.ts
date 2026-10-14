import { describe, expect, it } from 'vitest';
import { continueLog, loadSession, saveSession, SESSION_KEY } from '@/call-test/session-log';
import { summarizeCall, type CallEvent } from '@/call-test/report';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

const e = (at: number, kind: CallEvent['kind']): CallEvent => ({ at, kind });

describe('continueLog (final review #2)', () => {
  const prev = { provider: 'daily', room: 'tehran-1', events: [e(1, 'joined'), e(2, 'left')] };

  it('keeps the log when rejoining the same provider and room', () => {
    expect(continueLog(prev, 'daily', 'tehran-1')).toEqual(prev.events);
  });
  it('starts fresh for a different room or provider, or with nothing saved', () => {
    expect(continueLog(prev, 'daily', 'tehran-2')).toEqual([]);
    expect(continueLog(prev, 'livekit', 'tehran-1')).toEqual([]);
    expect(continueLog(null, 'daily', 'tehran-1')).toEqual([]);
  });
  it('a rejoin after leaving counts as an outage in the whole-session report', () => {
    const events = [...continueLog(prev, 'daily', 'tehran-1'), e(40_002, 'joined'), e(100_000, 'left')];
    expect(summarizeCall(events, 200_000)).toMatchObject({ outages: 1, longestOutageMs: 40_000, passed: false });
  });
});

describe('loadSession / saveSession', () => {
  it('round-trips through storage', () => {
    const s = new MemoryStorage();
    const session = { provider: 'livekit', room: 'r-1', events: [e(1, 'joined'), e(5, 'left')] };
    saveSession(s, session);
    expect(loadSession(s)).toEqual(session);
  });

  it('closes a log cut off by a page reload with a left at the last event', () => {
    const s = new MemoryStorage();
    saveSession(s, { provider: 'daily', room: 'r-1', events: [e(1, 'joined'), e(9, 'quality_low')] });
    expect(loadSession(s)?.events.at(-1)).toEqual({ at: 9, kind: 'left', detail: 'page_reload' });
  });

  it('returns null for missing, broken or foreign data, and survives a missing storage', () => {
    const s = new MemoryStorage();
    expect(loadSession(s)).toBeNull();
    s.setItem(SESSION_KEY, '{not json');
    expect(loadSession(s)).toBeNull();
    s.setItem(SESSION_KEY, JSON.stringify({ provider: 'daily', room: 'r', events: [{ at: 'x', kind: 'joined' }] }));
    expect(loadSession(s)).toBeNull();
    expect(loadSession(null)).toBeNull();
    expect(() => saveSession(null, { provider: 'daily', room: 'r', events: [] })).not.toThrow();
  });
});
