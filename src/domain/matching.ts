import { TZDate } from '@date-fns/tz';
import { DAY } from './types';

export type DoctorCandidate = {
  id: string;
  gender: 'female' | 'male';
  specialties: string[];
  upcomingSlots: Date[];
};
export type MatchNote = 'gender_relaxed' | 'no_specialty_match';

export function rankDoctors(i: {
  doctors: DoctorCandidate[];
  topic: string;
  genderPref: 'female' | 'male' | null;
  clientTimeZone: string;
  now: Date;
  limit?: number;
}): { doctors: DoctorCandidate[]; notes: MatchNote[] } {
  const notes: MatchNote[] = [];
  let pool = i.doctors;
  if (i.genderPref) {
    const filtered = pool.filter(d => d.gender === i.genderPref);
    if (filtered.length > 0) pool = filtered;
    else notes.push('gender_relaxed');
  }
  if (!pool.some(d => d.specialties.includes(i.topic))) notes.push('no_specialty_match');

  const weekEnd = i.now.getTime() + 7 * DAY;
  const isEvening = (t: Date) => {
    const h = new TZDate(t, i.clientTimeZone).getHours();
    return h >= 17 && h < 21;
  };
  const score = (d: DoctorCandidate) => {
    const soon = d.upcomingSlots.filter(s => s.getTime() >= i.now.getTime() && s.getTime() <= weekEnd);
    return (
      (d.specialties.includes(i.topic) ? 10 : 0) +
      (soon.length > 0 ? 3 : 0) +
      (soon.some(isEvening) ? 2 : 0)
    );
  };

  const ranked = pool
    .map((d, idx) => ({ d, idx, s: score(d) }))
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .slice(0, i.limit ?? 3)
    .map(x => x.d);
  return { doctors: ranked, notes };
}
