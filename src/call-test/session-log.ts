import type { CallEvent } from './report';

// The event log lives in this tab's sessionStorage (never on the server), so a reload
// or a rejoin of the same room keeps the evidence of the drop that caused it.
export const SESSION_KEY = 'therapyfarsi.callTest.session';

export interface StoredSession { provider: string; room: string; events: CallEvent[] }

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

export function continueLog(prev: StoredSession | null, provider: string, room: string): CallEvent[] {
  return prev && prev.provider === provider && prev.room === room ? prev.events : [];
}

const isEvent = (v: unknown): v is CallEvent =>
  typeof v === 'object' && v !== null &&
  typeof (v as CallEvent).at === 'number' && typeof (v as CallEvent).kind === 'string';

export function loadSession(storage: Reader | null): StoredSession | null {
  try {
    const raw = storage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof s.provider !== 'string' || typeof s.room !== 'string' || !Array.isArray(s.events) || !s.events.every(isEvent)) {
      return null;
    }
    const events = [...s.events];
    const last = events.at(-1);
    // A log that does not end in 'left' was cut off by a reload mid-call.
    if (last && last.kind !== 'left') events.push({ at: last.at, kind: 'left', detail: 'page_reload' });
    return { provider: s.provider, room: s.room, events };
  } catch {
    return null;
  }
}

export function saveSession(storage: Writer | null, session: StoredSession): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage full or blocked: the in-memory log still works for this page view.
  }
}
