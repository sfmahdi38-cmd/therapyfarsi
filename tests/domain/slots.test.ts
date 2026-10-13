import { describe, it, expect } from 'vitest';
import { TZDate } from '@date-fns/tz';
import { generateSlots, TEHRAN, type SlotOptions } from '@/domain/slots';

const opts: SlotOptions = { sessionMinutes: 50, bufferMinutes: 10, minLeadHours: 12, maxHorizonDays: 30 };
const tehran = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(new TZDate(y, m - 1, d, h, min, TEHRAN).getTime());

// 2026-10-24 and 2026-10-31 are Saturdays (weekday 6).
const now = new Date('2026-10-20T00:00:00Z');

describe('generateSlots', () => {
  it('builds a grid of session+buffer steps inside the rule', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    expect(slots.map(s => s.startsAt)).toEqual([
      tehran(2026, 10, 24, 18), tehran(2026, 10, 24, 19), tehran(2026, 10, 24, 20),
    ]);
    expect(slots[0]!.endsAt).toEqual(tehran(2026, 10, 24, 18, 50));
    expect(slots[0]!.blockedUntil).toEqual(tehran(2026, 10, 24, 19, 0));
  });

  it('session must fit, buffer may overflow the rule end', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '19:50' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    // 18:00 (ends 18:50) and 19:00 (ends 19:50, buffer to 20:00 overflows) both fit
    expect(slots).toHaveLength(2);
  });

  it('handles a rule ending at 24:00 (Review Focus 1)', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '22:00', end: '24:00' }],
      timeOff: [], busy: [], options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    expect(slots.map(s => s.startsAt)).toEqual([tehran(2026, 10, 24, 22), tehran(2026, 10, 24, 23)]);
  });

  it('London display shifts across UK DST end, Tehran stays fixed (spec 8-3)', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '21:00', end: '22:00' }],
      timeOff: [], busy: [], options: opts, now,
    });
    const oct24 = slots.find(s => s.startsAt.getTime() === tehran(2026, 10, 24, 21).getTime())!;
    const oct31 = slots.find(s => s.startsAt.getTime() === tehran(2026, 10, 31, 21).getTime())!;
    expect(new TZDate(oct24.startsAt, TEHRAN).getHours()).toBe(21);
    expect(new TZDate(oct31.startsAt, TEHRAN).getHours()).toBe(21);
    const london24 = new TZDate(oct24.startsAt, 'Europe/London');
    const london31 = new TZDate(oct31.startsAt, 'Europe/London');
    expect([london24.getHours(), london24.getMinutes()]).toEqual([18, 30]); // BST
    expect([london31.getHours(), london31.getMinutes()]).toEqual([17, 30]); // GMT
  });

  it('drops slots overlapping busy intervals, half-open', () => {
    const busy = [{ start: tehran(2026, 10, 24, 19), end: tehran(2026, 10, 24, 20) }];
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy, options: opts, now,
    }).filter(s => s.startsAt < new Date('2026-10-25T00:00:00Z'));
    // 18:00 blocks until 19:00 exactly → allowed (half-open); 19:00 dropped; 20:00 allowed
    expect(slots.map(s => s.startsAt)).toEqual([tehran(2026, 10, 24, 18), tehran(2026, 10, 24, 20)]);
  });

  it('drops slots overlapping time off', () => {
    const timeOff = [{ start: tehran(2026, 10, 24, 0), end: tehran(2026, 10, 25, 0) }];
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff, busy: [], options: opts, now,
    });
    expect(slots.some(s => s.startsAt < new Date('2026-10-25T00:00:00Z'))).toBe(false);
  });

  it('respects min lead and max horizon', () => {
    const lateNow = new Date(tehran(2026, 10, 24, 8).getTime()); // 10h before 18:00
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '18:00', end: '21:00' }],
      timeOff: [], busy: [], options: opts, now: lateNow,
    });
    expect(slots[0]!.startsAt).toEqual(tehran(2026, 10, 24, 20)); // 18:00 & 19:00 are < 12h away
    const last = slots[slots.length - 1]!;
    expect(last.startsAt.getTime()).toBeLessThanOrEqual(lateNow.getTime() + 30 * 24 * 3600_000);
  });

  it('returns slots sorted', () => {
    const slots = generateSlots({
      rules: [{ weekday: 6, start: '20:00', end: '21:00' }, { weekday: 6, start: '18:00', end: '19:00' }],
      timeOff: [], busy: [], options: opts, now,
    });
    const times = slots.map(s => s.startsAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
