import { afterEach, describe, expect, it, vi } from 'vitest';
import { dailyJoin } from '@/video/daily';
import { ProviderFailed } from '@/video/types';
import { jsonResponse, mockFetch } from './fetch-mock';

const API = 'https://api.daily.co/v1';
const cfg = { apiKey: 'dk_test', domain: 'thropy.daily.co' };
const now = new Date('2026-10-14T17:00:00Z');
const req = { room: 'calltest-abc', identity: 'id-1', displayName: 'مانی', ttlSeconds: 7200, now };
const exp = Math.floor(now.getTime() / 1000) + 7200;

afterEach(() => vi.unstubAllGlobals());

describe('dailyJoin', () => {
  it('creates a missing room: private, two people, device check first, no recording', async () => {
    const f = mockFetch({
      [`GET ${API}/rooms/calltest-abc`]: () => jsonResponse({ error: 'not-found' }, 404),
      [`POST ${API}/rooms`]: () => jsonResponse({ name: 'calltest-abc' }),
      [`POST ${API}/meeting-tokens`]: () => jsonResponse({ token: 'tok-1' }),
    });

    const out = await dailyJoin(cfg, req);

    expect(out).toEqual({
      provider: 'daily',
      url: 'https://thropy.daily.co/calltest-abc',
      token: 'tok-1',
      expiresAt: new Date(exp * 1000).toISOString(),
    });
    const room = f.bodyOf(`POST ${API}/rooms`);
    expect(room).toMatchObject({
      name: 'calltest-abc',
      privacy: 'private',
      properties: { exp, max_participants: 2, eject_at_room_exp: true, enable_prejoin_ui: true, enable_chat: false },
    });
    expect(JSON.stringify(room)).not.toMatch(/record/);
    expect(f.bodyOf(`POST ${API}/meeting-tokens`)).toEqual({
      properties: { room_name: 'calltest-abc', user_name: 'مانی', user_id: 'id-1', exp, eject_at_token_exp: true },
    });
    expect(f.headersOf(`GET ${API}/rooms/calltest-abc`).get('Authorization')).toBe('Bearer dk_test');
  });

  it('refreshes an existing room (Review Focus 2: same room name on a later day)', async () => {
    const f = mockFetch({
      [`GET ${API}/rooms/calltest-abc`]: () => jsonResponse({ name: 'calltest-abc', config: { exp: 1 } }),
      [`POST ${API}/rooms/calltest-abc`]: () => jsonResponse({ name: 'calltest-abc' }),
      [`POST ${API}/meeting-tokens`]: () => jsonResponse({ token: 'tok-2' }),
    });

    const out = await dailyJoin(cfg, req);

    expect(out.token).toBe('tok-2');
    expect(f.keys()).not.toContain(`POST ${API}/rooms`);
    expect(f.bodyOf(`POST ${API}/rooms/calltest-abc`)).toMatchObject({
      properties: { exp, max_participants: 2 },
    });
  });

  it('turns a refused token into ProviderFailed', async () => {
    mockFetch({
      [`GET ${API}/rooms/calltest-abc`]: () => jsonResponse({ error: 'not-found' }, 404),
      [`POST ${API}/rooms`]: () => jsonResponse({ name: 'calltest-abc' }),
      [`POST ${API}/meeting-tokens`]: () => jsonResponse({ error: 'authorization-error' }, 401),
    });
    await expect(dailyJoin(cfg, req)).rejects.toBeInstanceOf(ProviderFailed);
  });

  it('turns an unexpected room lookup error into ProviderFailed', async () => {
    mockFetch({ [`GET ${API}/rooms/calltest-abc`]: () => jsonResponse({ error: 'server' }, 500) });
    await expect(dailyJoin(cfg, req)).rejects.toBeInstanceOf(ProviderFailed);
  });
});
