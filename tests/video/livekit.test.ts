import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenVerifier } from 'livekit-server-sdk';
import { livekitJoin } from '@/video/livekit';
import { ProviderFailed } from '@/video/types';
import { jsonResponse, mockFetch } from './fetch-mock';

const cfg = { url: 'wss://tropifarsi-x.livekit.cloud', apiKey: 'APIkey123', apiSecret: 'secret-secret-secret-secret-secret-1' };
const CREATE = 'POST https://tropifarsi-x.livekit.cloud/twirp/livekit.RoomService/CreateRoom';
const req = { room: 'calltest-abc', identity: 'id-1', displayName: 'مانی', ttlSeconds: 7200, now: new Date('2026-10-14T17:00:00Z') };

afterEach(() => vi.unstubAllGlobals());

describe('livekitJoin', () => {
  it('makes a two-person room and a token that only joins that room', async () => {
    const f = mockFetch({ [CREATE]: () => jsonResponse({ name: 'calltest-abc', sid: 'RM_1' }) });

    const out = await livekitJoin(cfg, req);

    expect(out.provider).toBe('livekit');
    expect(out.url).toBe(cfg.url);
    expect(out.expiresAt).toBe('2026-10-14T19:00:00.000Z');
    const body = f.bodyOf(CREATE);
    expect(body.name).toBe('calltest-abc');
    expect(body.maxParticipants ?? body.max_participants).toBe(2);

    const claims = await new TokenVerifier(cfg.apiKey, cfg.apiSecret).verify(out.token);
    expect(claims.video).toMatchObject({ room: 'calltest-abc', roomJoin: true, canPublish: true, canSubscribe: true });
    expect(claims.sub).toBe('id-1');
    expect(claims.name).toBe('مانی');
  });

  it('turns a refused room into ProviderFailed', async () => {
    mockFetch({ [CREATE]: () => jsonResponse({ code: 'unauthenticated', msg: 'bad key' }, 401) });
    await expect(livekitJoin(cfg, req)).rejects.toBeInstanceOf(ProviderFailed);
  });
});
