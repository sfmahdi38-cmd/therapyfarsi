import { describe, expect, it } from 'vitest';
import { ConnectionTracker } from '@/call-test/connection-tracker';

describe('ConnectionTracker', () => {
  it('stays down until every interrupted link is back (final review #3)', () => {
    const c = new ConnectionTracker();
    expect(c.update('signaling', 'interrupted')).toBe('reconnecting');
    expect(c.update('sfu', 'interrupted')).toBeNull();
    expect(c.update('signaling', 'connected')).toBeNull(); // media still down
    expect(c.update('sfu', 'connected')).toBe('reconnected');
  });

  it('ignores connected without a prior interruption and repeated interruptions', () => {
    const c = new ConnectionTracker();
    expect(c.update('signaling', 'connected')).toBeNull();
    expect(c.update('sfu', 'interrupted')).toBe('reconnecting');
    expect(c.update('sfu', 'interrupted')).toBeNull();
    expect(c.update('sfu', 'connected')).toBe('reconnected');
  });

  it('clearing a link that the departed peer took down ends the outage only if it was the last', () => {
    const c = new ConnectionTracker();
    c.update('peer-to-peer', 'interrupted');
    expect(c.clear('peer-to-peer')).toBe('reconnected');

    c.update('peer-to-peer', 'interrupted');
    c.update('signaling', 'interrupted');
    expect(c.clear('peer-to-peer')).toBeNull();
    expect(c.clear('peer-to-peer')).toBeNull();
  });
});
