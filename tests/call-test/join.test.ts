import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCallTestJoin, safeEqual } from '@/call-test/join';
import { jsonResponse, mockFetch } from '../video/fetch-mock';

const API = 'https://api.daily.co/v1';
const env = { CALL_TEST_CODE: 'open-sesame-42', DAILY_API_KEY: 'dk', DAILY_DOMAIN: 'thropy.daily.co' };
const good = { code: 'open-sesame-42', provider: 'daily', room: 'tehran-1', name: 'دکتر الف' };
const now = new Date('2026-10-14T17:00:00Z');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safeEqual', () => {
  it('compares exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});

describe('handleCallTestJoin', () => {
  it('is disabled when no code is configured', async () => {
    const f = mockFetch({});
    expect(await handleCallTestJoin(good, { ...env, CALL_TEST_CODE: undefined }, now)).toEqual({ status: 503, body: { error: 'disabled' } });
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('rejects a wrong code without calling any provider (Review Focus 1)', async () => {
    const f = mockFetch({});
    for (const input of [{ ...good, code: 'wrong' }, { ...good, code: undefined }, null, 'text']) {
      expect(await handleCallTestJoin(input, env, now)).toEqual({ status: 403, body: { error: 'forbidden' } });
    }
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider', async () => {
    expect(await handleCallTestJoin({ ...good, provider: 'zoom' }, env, now)).toEqual({ status: 400, body: { error: 'invalid_provider' } });
  });

  it('rejects bad room names (Review Focus 5)', async () => {
    const f = mockFetch({});
    for (const room of ['Tehran 1', 'اتاق', 'ab', 'a'.repeat(41), 'room_1', 42]) {
      expect(await handleCallTestJoin({ ...good, room }, env, now)).toEqual({ status: 400, body: { error: 'invalid_room' } });
    }
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('rejects empty or long names', async () => {
    for (const name of ['   ', 'x'.repeat(41), undefined]) {
      expect(await handleCallTestJoin({ ...good, name }, env, now)).toEqual({ status: 400, body: { error: 'invalid_name' } });
    }
  });

  it('reports an unconfigured provider as 503', async () => {
    expect(await handleCallTestJoin({ ...good, provider: 'livekit' }, env, now)).toEqual({ status: 503, body: { error: 'provider_unconfigured' } });
  });

  it('joins a calltest- prefixed room with a 2-hour token', async () => {
    const f = mockFetch({
      [`GET ${API}/rooms/calltest-tehran-1`]: () => jsonResponse({}, 404),
      [`POST ${API}/rooms`]: () => jsonResponse({ name: 'calltest-tehran-1' }),
      [`POST ${API}/meeting-tokens`]: () => jsonResponse({ token: 'tok' }),
    });
    const out = await handleCallTestJoin(good, env, now);
    expect(out).toEqual({
      status: 200,
      body: { provider: 'daily', url: 'https://thropy.daily.co/calltest-tehran-1', token: 'tok', expiresAt: '2026-10-14T19:00:00.000Z' },
    });
    expect(f.bodyOf(`POST ${API}/meeting-tokens`)).toMatchObject({ properties: { user_name: 'دکتر الف' } });
  });

  it('maps a provider failure to 502', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch({ [`GET ${API}/rooms/calltest-tehran-1`]: () => jsonResponse({}, 500) });
    expect(await handleCallTestJoin(good, env, now)).toEqual({ status: 502, body: { error: 'provider_failed' } });
  });
});
