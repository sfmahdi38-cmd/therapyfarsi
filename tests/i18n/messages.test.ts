import { describe, it, expect } from 'vitest';
import fa from '../../messages/fa.json';
import en from '../../messages/en.json';
import { resolveLocale, dirOf } from '@/i18n/locale';

function leaves(o: unknown, prefix = ''): [string, unknown][] {
  if (typeof o !== 'object' || o === null) return [[prefix, o]];
  return Object.entries(o).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe('messages', () => {
  it('fa and en have exactly the same keys', () => {
    expect(leaves(en).map(([k]) => k).sort()).toEqual(leaves(fa).map(([k]) => k).sort());
  });
  it('no empty strings', () => {
    for (const [k, v] of [...leaves(fa), ...leaves(en)]) {
      expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true);
    }
  });
});

describe('locale', () => {
  it('defaults to Persian for missing or unknown values', () => {
    expect(resolveLocale(undefined)).toBe('fa');
    expect(resolveLocale('de')).toBe('fa');
    expect(resolveLocale('en')).toBe('en');
  });
  it('Persian is right-to-left', () => {
    expect(dirOf('fa')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});
