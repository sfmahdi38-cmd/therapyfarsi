import { describe, it, expect } from 'vitest';
import { HOUR, DAY } from '@/domain/types';

describe('setup', () => {
  it('constants', () => {
    expect(DAY).toBe(24 * HOUR);
  });
});
