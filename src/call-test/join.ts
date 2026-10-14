import {
  createJoin, ProviderFailed, ProviderUnconfigured, VIDEO_PROVIDERS,
  type JoinInfo, type VideoEnv, type VideoProvider,
} from '@/video';

export const CALL_TEST_TTL_SECONDS = 2 * 60 * 60;
const ROOM_RE = /^[a-z0-9-]{3,40}$/;
const MAX_NAME = 40;

export interface CallTestEnv extends VideoEnv { CALL_TEST_CODE?: string }

export type CallTestError =
  | 'disabled' | 'forbidden' | 'invalid_provider' | 'invalid_room'
  | 'invalid_name' | 'provider_unconfigured' | 'provider_failed';

export type CallTestJoinResult =
  | { status: 200; body: JoinInfo }
  | { status: 400 | 403 | 502 | 503; body: { error: CallTestError } };

/** Constant-time for equal lengths; length difference is folded into the result. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const fail = (status: 400 | 403 | 502 | 503, error: CallTestError): CallTestJoinResult => ({ status, body: { error } });

export async function handleCallTestJoin(input: unknown, env: CallTestEnv, now = new Date()): Promise<CallTestJoinResult> {
  if (!env.CALL_TEST_CODE) return fail(503, 'disabled');
  const body = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;

  // The code is checked before anything else so strangers learn nothing and cost nothing.
  if (typeof body.code !== 'string' || !safeEqual(body.code, env.CALL_TEST_CODE)) return fail(403, 'forbidden');
  if (!VIDEO_PROVIDERS.includes(body.provider as VideoProvider)) return fail(400, 'invalid_provider');
  if (typeof body.room !== 'string' || !ROOM_RE.test(body.room)) return fail(400, 'invalid_room');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME) return fail(400, 'invalid_name');

  try {
    const info = await createJoin(body.provider as VideoProvider, env, {
      room: `calltest-${body.room}`,
      identity: crypto.randomUUID(),
      displayName: name,
      ttlSeconds: CALL_TEST_TTL_SECONDS,
      now,
    });
    return { status: 200, body: info };
  } catch (e) {
    if (e instanceof ProviderUnconfigured) return fail(503, 'provider_unconfigured');
    if (e instanceof ProviderFailed) {
      console.error('call-test provider failed:', e.message);
      return fail(502, 'provider_failed');
    }
    throw e;
  }
}
