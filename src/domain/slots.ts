import { TZDate } from '@date-fns/tz';
import { DAY, HOUR, MINUTE, type Interval } from './types';

export const TEHRAN = 'Asia/Tehran';

export type WeeklyRule = { weekday: number; start: string; end: string };
export type SlotOptions = {
  sessionMinutes: number;
  bufferMinutes: number;
  minLeadHours: number;
  maxHorizonDays: number;
};
export type Slot = { startsAt: Date; endsAt: Date; blockedUntil: Date };

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function generateSlots(input: {
  rules: WeeklyRule[];
  timeOff: Interval[];
  busy: Interval[];
  options: SlotOptions;
  now: Date;
}): Slot[] {
  const { rules, timeOff, busy, options, now } = input;
  if (!(options.sessionMinutes > 0) || !(options.bufferMinutes >= 0)) throw new Error('invalid_slot_options');
  const earliest = now.getTime() + options.minLeadHours * HOUR;
  const latest = now.getTime() + options.maxHorizonDays * DAY;
  const sessionMs = options.sessionMinutes * MINUTE;
  const stepMs = (options.sessionMinutes + options.bufferMinutes) * MINUTE;
  const blocked = [...timeOff, ...busy];
  const out: Slot[] = [];
  const seen = new Set<number>();

  const first = new TZDate(now, TEHRAN);
  for (let i = 0; i <= options.maxHorizonDays + 1; i++) {
    const day = new TZDate(first.getFullYear(), first.getMonth(), first.getDate() + i, TEHRAN);
    const weekday = day.getDay();
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      const ruleStart = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(rule.start), TEHRAN).getTime();
      const ruleEnd = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(rule.end), TEHRAN).getTime();
      for (let s = ruleStart; s + sessionMs <= ruleEnd; s += stepMs) {
        if (s < earliest || s > latest || seen.has(s)) continue;
        const slot: Slot = {
          startsAt: new Date(s),
          endsAt: new Date(s + sessionMs),
          blockedUntil: new Date(s + stepMs),
        };
        const range = { start: slot.startsAt, end: slot.blockedUntil };
        if (blocked.some(b => overlaps(range, b))) continue;
        seen.add(s);
        out.push(slot);
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
