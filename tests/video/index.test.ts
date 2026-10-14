import { describe, expect, it } from 'vitest';
import { createJoin, ProviderUnconfigured } from '@/video';

const req = { room: 'calltest-abc', identity: 'id-1', displayName: 'x', ttlSeconds: 60, now: new Date() };

describe('createJoin', () => {
  it('refuses Daily without key or domain', async () => {
    await expect(createJoin('daily', { DAILY_DOMAIN: 'x.daily.co' }, req)).rejects.toBeInstanceOf(ProviderUnconfigured);
    await expect(createJoin('daily', { DAILY_API_KEY: 'k', DAILY_DOMAIN: '' }, req)).rejects.toBeInstanceOf(ProviderUnconfigured);
  });
  it('refuses LiveKit without url, key or secret', async () => {
    await expect(createJoin('livekit', { LIVEKIT_URL: 'wss://x', LIVEKIT_API_KEY: 'k' }, req)).rejects.toBeInstanceOf(ProviderUnconfigured);
  });
});
