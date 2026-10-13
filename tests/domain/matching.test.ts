import { describe, it, expect } from 'vitest';
import { rankDoctors, type DoctorCandidate } from '@/domain/matching';

const now = new Date('2026-10-20T00:00:00Z');
// 2026-10-21 17:30 UTC = 21:00 Tehran = 18:30 London (BST) = 13:30 New York = 23:00 Kolkata
const slot = new Date('2026-10-21T17:30:00Z');
const d = (id: string, gender: 'female' | 'male', specialties: string[], upcomingSlots: Date[] = [slot]): DoctorCandidate =>
  ({ id, gender, specialties, upcomingSlots });

describe('rankDoctors', () => {
  it('ranks specialty matches first', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['sleep']), d('b', 'female', ['anxiety'])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
    expect(r.notes).toEqual([]);
  });

  it('gender with no result relaxes the filter and says so', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'])],
      topic: 'anxiety', genderPref: 'female', clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['a']);
    expect(r.notes).toContain('gender_relaxed');
  });

  it('gender filter applies when it has results', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety']), d('b', 'female', ['sleep'])],
      topic: 'anxiety', genderPref: 'female', clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b']);
  });

  it('US evening mismatch never empties the list', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'America/New_York', now,
    });
    expect(r.doctors).toHaveLength(1);
  });

  it('evening bonus breaks ties in client local time (London 18:30 yes)', () => {
    const noon = new Date('2026-10-21T08:30:00Z'); // 09:30 London
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [noon]), d('b', 'male', ['anxiety'], [slot])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
  });

  it('half-hour timezone uses local clock (Review Focus 5)', () => {
    const kolkataEvening = new Date('2026-10-21T13:00:00Z'); // 18:30 Kolkata
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [slot]), d('b', 'male', ['anxiety'], [kolkataEvening])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Asia/Kolkata', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']); // slot is 23:00 Kolkata → no bonus
  });

  it('no specialty match still returns doctors with a note, limit 3', () => {
    const r = rankDoctors({
      doctors: [d('a', 'male', ['x']), d('b', 'male', ['x']), d('c', 'male', ['x']), d('e', 'male', ['x'])],
      topic: 'grief', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors).toHaveLength(3);
    expect(r.notes).toContain('no_specialty_match');
  });

  it('slots beyond 7 days earn no availability points', () => {
    const far = new Date('2026-10-28T17:30:00Z');
    const r = rankDoctors({
      doctors: [d('a', 'male', ['anxiety'], [far]), d('b', 'male', ['anxiety'], [slot])],
      topic: 'anxiety', genderPref: null, clientTimeZone: 'Europe/London', now,
    });
    expect(r.doctors.map(x => x.id)).toEqual(['b', 'a']);
  });
});
