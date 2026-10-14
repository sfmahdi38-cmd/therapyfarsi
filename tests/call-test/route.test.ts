import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/call-test/join/route';

afterEach(() => vi.unstubAllEnvs());

describe('POST /api/call-test/join', () => {
  it('treats a non-JSON body as unauthenticated and never caches', async () => {
    vi.stubEnv('CALL_TEST_CODE', 'open-sesame-42');
    const res = await POST(new Request('http://localhost/api/call-test/join', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
