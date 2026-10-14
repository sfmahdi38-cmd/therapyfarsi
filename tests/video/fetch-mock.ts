import { vi } from 'vitest';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Call { key: string; body: string | undefined; headers: Headers }

/** Stubs global fetch with exact "METHOD url" routes. Unknown routes throw, so a surprise call fails the test. */
export function mockFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = req ? req.url : String(input);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const body = init?.body != null ? String(init.body) : req ? await req.clone().text() : undefined;
    calls.push({ key, body, headers: new Headers(init?.headers ?? req?.headers) });
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fn);

  const find = (key: string): Call => {
    const call = calls.find((c) => c.key === key);
    if (!call) throw new Error(`no fetch call: ${key} (got: ${calls.map((c) => c.key).join(', ')})`);
    return call;
  };
  return {
    fn,
    keys: () => calls.map((c) => c.key),
    bodyOf: (key: string) => JSON.parse(find(key).body ?? 'null') as Record<string, unknown>,
    headersOf: (key: string) => find(key).headers,
  };
}
