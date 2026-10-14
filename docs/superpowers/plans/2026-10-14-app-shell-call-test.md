# App Shell + Call Test (Plan 3 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js app on Cloudflare Workers (Persian, RTL, self-hosted font) with a temporary, code-protected `/call-test` page that runs real 50-minute Daily and LiveKit calls from Iran and produces a copyable quality report — the tool for spec step 0-A.

**Architecture:** Next.js App Router in `src/app`, deployed with OpenNext to Workers. Video providers sit behind `src/video` (server-only: room + short-lived token per provider). The call-test API route validates an access code and input, then asks `src/video` for a join token; nothing is stored server-side. The browser runs the provider's prebuilt UI (Daily Prebuilt iframe / LiveKit `VideoConference`), records connection events, and `src/call-test/report.ts` (pure, tested) turns them into a plain-text report the tester copies to the owner.

**Tech Stack:** Next.js 16.4.0, React 19.3.0, next-intl 4.14.9, @opennextjs/cloudflare 1.20.11, wrangler 4.151.0, @fontsource-variable/vazirmatn 5.3.0, @daily-co/daily-js 0.93.0, livekit-server-sdk 2.19.1, livekit-client 2.22.4, @livekit/components-react 2.9.24, @livekit/components-styles 1.2.0, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-tropifarsi-design.md` — sections 8-1, 8-2, 9 (call privacy), 10 (step 0-A), 4-7 (device test, audio-only), 13; section 16 (step 0-C runs in parallel with 0-A).

**Out of scope here:** Cloudflare Realtime (no account/keys yet; added as a third provider only if Daily and LiveKit both fail the test), Supabase Auth, any real product page. The call-test page and its API route are deleted after step 0-A.

## Global Constraints

- The doctor's browser talks only to `tropifarsi.com`, email, and the video server (spec 8-2). No Google Fonts, no third-party CDN: Vazirmatn comes from `@fontsource-variable/vazirmatn` and is served from our own domain.
- Calls are never recorded (spec 9). Never set any recording property on a Daily room/token; never start LiveKit egress.
- A room admits at most 2 people (spec 9: "no third person"): Daily `max_participants: 2`, LiveKit `maxParticipants: 2`.
- Persian is the default locale, `dir="rtl"`; English exists as a second message file with identical keys (spec 8-1 next-intl).
- Call-test join tokens live 2 hours (`CALL_TEST_TTL_SECONDS = 7200`): a 50-minute test plus slack. Product tokens (later plan) follow spec 9's window.
- `/call-test` is `noindex` and every join requires `CALL_TEST_CODE` (secret). If the secret is unset the API answers `503 disabled`.
- Room names users type: `^[a-z0-9-]{3,40}$`; the server prefixes `calltest-`.
- Nothing from a call test is stored server-side. The report is text the tester copies.
- Pin the exact versions in the Tech Stack line.
- **Windows:** OpenNext builds on Windows but the built worker fails at runtime (verified 2026-10-14: `Unexpected loadManifest(/.next/server/preview-props.json)`). Production builds run on Linux (Cloudflare Workers Builds). Locally use `npm run dev` (`next dev`), which works.

## Review Focus

1. Wrong or missing access code → `403` **before** any provider API call (no rooms created, no minutes billed). → Task 3 test "rejects a wrong code without calling any provider".
2. The same room name reused on a later day (Daily room exists with an old `exp`) → the room's settings and `exp` are refreshed and joining works. → Task 2 test "refreshes an existing room".
3. Tester leaves while reconnecting and never rejoins → that outage counts up to the moment they left and the call is `FAIL`. → Task 4 test "left while reconnecting".
4. The other person hangs up normally at the end of the call → not counted as a drop; a clean call is `PASS`. → Task 4 test "clean 50-minute call".
5. Room typed with Persian letters, uppercase or spaces → client trims and lowercases; the server rejects anything still invalid with `invalid_room`, shown as a Persian message. → Task 3 test "rejects bad room names".

---

## File Structure

```
next.config.ts                    next-intl plugin
open-next.config.ts               OpenNext Cloudflare config
wrangler.jsonc                    Worker config (custom domain added in Task 6)
.node-version                     Node 24 for Workers Builds
messages/fa.json, messages/en.json
src/i18n/locale.ts                locales, resolveLocale, dirOf
src/i18n/request.ts               next-intl request config (cookie NEXT_LOCALE, default fa)
src/app/layout.tsx                <html lang dir>, font, provider
src/app/globals.css               design tokens from docs/design/homepage-mockup.html
src/app/page.tsx                  placeholder home
src/video/types.ts                VideoProvider, JoinRequest, JoinInfo, errors (client-safe)
src/video/daily.ts                Daily REST: upsert room, meeting token
src/video/livekit.ts              LiveKit: create room, access token
src/video/index.ts                createJoin(provider, env, req)
src/call-test/join.ts             handleCallTestJoin, safeEqual (server)
src/call-test/report.ts           summarizeCall, formatReport, formatDuration (pure)
src/app/api/call-test/join/route.ts
src/app/call-test/page.tsx        noindex server page
src/app/call-test/CallTestClient.tsx
src/app/call-test/call-view.ts    CallViewProps
src/app/call-test/DailyCallView.tsx
src/app/call-test/LiveKitCallView.tsx
src/app/call-test/ReportPanel.tsx
docs/call-test/README.md          Persian test protocol + deploy runbook
tests/i18n/messages.test.ts
tests/video/fetch-mock.ts, daily.test.ts, livekit.test.ts, index.test.ts
tests/call-test/join.test.ts, route.test.ts, report.test.ts
```

---

### Task 1: Next.js shell on Cloudflare (RTL, i18n, font)

**Files:**
- Create: `next.config.ts`, `open-next.config.ts`, `wrangler.jsonc`, `messages/fa.json`, `messages/en.json`, `src/i18n/locale.ts`, `src/i18n/request.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
- Modify: `package.json` (deps, scripts), `tsconfig.json`, `.gitignore`
- Test: `tests/i18n/messages.test.ts`

**Interfaces:**
- Produces: `resolveLocale(v: string | undefined): Locale`, `dirOf(l: Locale): 'rtl' | 'ltr'`, `type Locale = 'fa' | 'en'` from `@/i18n/locale`. Message namespaces `meta`, `home` (Task 5 adds `callTest`). CSS tokens `--bg --surface --ink --muted --cypress --firouzeh --firouzeh-dark --anar --line --radius-s --font-ui` and classes `.page .brand .muted`.

- [ ] **Step 1: Install**

```bash
npm i next@16.4.0 react@19.3.0 react-dom@19.3.0 next-intl@4.14.9 @fontsource-variable/vazirmatn@5.3.0 @opennextjs/cloudflare@1.20.11
npm i -D wrangler@4.151.0 @types/react @types/react-dom
```

- [ ] **Step 2: Write the failing test**

`tests/i18n/messages.test.ts`:
```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/i18n`
Expected: FAIL — cannot resolve `../../messages/fa.json` / `@/i18n/locale`.

- [ ] **Step 4: Write locale + messages**

`src/i18n/locale.ts`:
```ts
export const locales = ['fa', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'fa';

export function resolveLocale(value: string | undefined): Locale {
  return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : defaultLocale;
}

export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (locale === 'fa' ? 'rtl' : 'ltr');
```

`messages/fa.json`:
```json
{
  "meta": { "title": "تراپی‌فارسی", "description": "مشاوره و روان‌درمانی آنلاین به زبان فارسی" },
  "home": { "brand": "تراپی‌فارسی", "soon": "به‌زودی. سایت در حال ساخت است." }
}
```

`messages/en.json`:
```json
{
  "meta": { "title": "TropiFarsi", "description": "Online counselling and psychotherapy in Persian" },
  "home": { "brand": "TropiFarsi", "soon": "Coming soon. The site is being built." }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/i18n`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the Next.js and Cloudflare config**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

`open-next.config.ts`:
```ts
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
```

`wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tropifarsi",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "observability": { "enabled": true }
}
```

`tsconfig.json` (replace whole file; Next may reorder keys on first build — accept its edits as long as these values stay):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "incremental": true,
    "noEmit": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts", "src", "tests", "vitest.config.ts", "next.config.ts", "open-next.config.ts",
    ".next/types/**/*.ts", ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules", ".open-next"]
}
```

`package.json` — keep existing scripts and add:
```json
"dev": "next dev",
"build": "next build",
"cf:build": "opennextjs-cloudflare build",
"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
```

`.gitignore` — append:
```
next-env.d.ts
*.tsbuildinfo
.dev.vars*
```

- [ ] **Step 7: Write the app shell**

`src/i18n/request.ts`:
```ts
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { resolveLocale } from './locale';

export default getRequestConfig(async () => {
  const locale = resolveLocale((await cookies()).get('NEXT_LOCALE')?.value);
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import '@fontsource-variable/vazirmatn';
import './globals.css';
import { dirOf, resolveLocale } from '@/i18n/locale';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: t('title'), description: t('description') };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = resolveLocale(await getLocale());
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`src/app/globals.css` (tokens copied from `docs/design/homepage-mockup.html`; display font intentionally omitted — no external font host):
```css
:root {
  --bg: #F3F6F3;
  --surface: #FFFFFF;
  --ink: #17302A;
  --muted: #4E6A62;
  --cypress: #2F5D50;
  --firouzeh: #1A8C8A;
  --firouzeh-dark: #126B69;
  --anar: #A12C4A;
  --line: #D3DDD7;
  --radius-s: 10px;
  --font-ui: 'Vazirmatn Variable', system-ui, sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: 17px;
  line-height: 1.9;
}

.page { max-width: 960px; margin: 0 auto; padding: 32px 16px; }
.brand { color: var(--cypress); font-size: 2rem; margin: 0 0 8px; }
.muted { color: var(--muted); }
```

`src/app/page.tsx`:
```tsx
import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <main className="page">
      <h1 className="brand">{t('brand')}</h1>
      <p className="muted">{t('soon')}</p>
    </main>
  );
}
```

- [ ] **Step 8: Verify build, types, tests, and the page**

Run: `npm test && npm run typecheck && npm run build`
Expected: all existing domain/db tests plus the 4 new ones pass; typecheck clean; `next build` lists route `/` (dynamic, because it reads a cookie).

Run: `npm run cf:build`
Expected: ends with `OpenNext build complete.` (the Windows runtime bug does not affect the build step; do not run `wrangler dev` here).

Run `npm run dev` in the background, then `curl -s http://localhost:3000/ | grep -o '<html[^>]*>'`
Expected: `<html lang="fa" dir="rtl">`. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore next.config.ts open-next.config.ts wrangler.jsonc messages src/i18n src/app tests/i18n
git commit -m "feat(app): Next.js shell on Cloudflare with Persian RTL, next-intl and self-hosted Vazirmatn"
```

---

### Task 2: Video provider layer (Daily + LiveKit)

**Files:**
- Create: `src/video/types.ts`, `src/video/daily.ts`, `src/video/livekit.ts`, `src/video/index.ts`
- Test: `tests/video/fetch-mock.ts`, `tests/video/daily.test.ts`, `tests/video/livekit.test.ts`, `tests/video/index.test.ts`

**Interfaces:**
- Produces (`@/video/types`, safe to import from client code):
  ```ts
  type VideoProvider = 'daily' | 'livekit';
  const VIDEO_PROVIDERS: readonly VideoProvider[];
  interface JoinRequest { room: string; identity: string; displayName: string; ttlSeconds: number; now: Date }
  interface JoinInfo { provider: VideoProvider; url: string; token: string; expiresAt: string }
  class ProviderUnconfigured extends Error { provider: VideoProvider }
  class ProviderFailed extends Error { provider: VideoProvider }
  ```
- Produces (`@/video`, server only): `interface VideoEnv { DAILY_API_KEY?; DAILY_DOMAIN?; LIVEKIT_URL?; LIVEKIT_API_KEY?; LIVEKIT_API_SECRET? }` (all `string | undefined`), `createJoin(provider: VideoProvider, env: VideoEnv, req: JoinRequest): Promise<JoinInfo>`; re-exports everything from `./types`.
- Produces (tests): `mockFetch(routes)` and `jsonResponse(body, status?)` in `tests/video/fetch-mock.ts` (Task 3 reuses them).

- [ ] **Step 1: Write the fetch mock helper**

`tests/video/fetch-mock.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing tests**

`tests/video/daily.test.ts`:
```ts
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
```

`tests/video/livekit.test.ts`:
```ts
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
```

> If the first LiveKit test fails with `unexpected fetch: <key>`, the SDK uses a different twirp URL than `CREATE`; set `CREATE` to the key printed in the error. Do not loosen the mock.

`tests/video/index.test.ts`:
```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm i @daily-co/daily-js@0.93.0 livekit-server-sdk@2.19.1 livekit-client@2.22.4 @livekit/components-react@2.9.24 @livekit/components-styles@1.2.0 && npx vitest run tests/video`
Expected: FAIL — cannot resolve `@/video/daily`, `@/video/livekit`, `@/video/types`, `@/video`.

- [ ] **Step 4: Implement**

`src/video/types.ts`:
```ts
export type VideoProvider = 'daily' | 'livekit';
export const VIDEO_PROVIDERS: readonly VideoProvider[] = ['daily', 'livekit'];

export interface JoinRequest {
  room: string;
  identity: string;
  displayName: string;
  ttlSeconds: number;
  now: Date;
}

export interface JoinInfo {
  provider: VideoProvider;
  url: string;
  token: string;
  expiresAt: string; // ISO
}

export class ProviderUnconfigured extends Error {
  readonly provider: VideoProvider;
  constructor(provider: VideoProvider) {
    super(`${provider} is not configured`);
    this.name = 'ProviderUnconfigured';
    this.provider = provider;
  }
}

export class ProviderFailed extends Error {
  readonly provider: VideoProvider;
  constructor(provider: VideoProvider, step: string) {
    super(`${provider} ${step}`);
    this.name = 'ProviderFailed';
    this.provider = provider;
  }
}
```

`src/video/daily.ts`:
```ts
import { ProviderFailed, type JoinInfo, type JoinRequest } from './types';

const API = 'https://api.daily.co/v1';

export interface DailyConfig { apiKey: string; domain: string }

// Recording is never enabled: no recording property is sent, so the domain default (off) applies.
function roomProperties(exp: number) {
  return {
    exp,
    max_participants: 2,
    eject_at_room_exp: true,
    enable_prejoin_ui: true,
    enable_network_ui: true,
    enable_chat: false,
    enable_screenshare: false,
  };
}

export async function dailyJoin(cfg: DailyConfig, req: JoinRequest): Promise<JoinInfo> {
  const exp = Math.floor(req.now.getTime() / 1000) + req.ttlSeconds;
  const headers = { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' };
  const roomUrl = `${API}/rooms/${encodeURIComponent(req.room)}`;

  const existing = await fetch(roomUrl, { headers });
  if (existing.status === 404) {
    const created = await fetch(`${API}/rooms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: req.room, privacy: 'private', properties: roomProperties(exp) }),
    });
    if (!created.ok) throw new ProviderFailed('daily', `create_room ${created.status}`);
  } else if (existing.ok) {
    // An old room keeps its old exp; refresh it so a reused name still works.
    const updated = await fetch(roomUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ properties: roomProperties(exp) }),
    });
    if (!updated.ok) throw new ProviderFailed('daily', `update_room ${updated.status}`);
  } else {
    throw new ProviderFailed('daily', `get_room ${existing.status}`);
  }

  const tokenRes = await fetch(`${API}/meeting-tokens`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      properties: {
        room_name: req.room,
        user_name: req.displayName,
        user_id: req.identity,
        exp,
        eject_at_token_exp: true,
      },
    }),
  });
  if (!tokenRes.ok) throw new ProviderFailed('daily', `meeting_token ${tokenRes.status}`);
  const { token } = (await tokenRes.json()) as { token: string };

  return {
    provider: 'daily',
    url: `https://${cfg.domain}/${req.room}`,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}
```

`src/video/livekit.ts`:
```ts
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { ProviderFailed, type JoinInfo, type JoinRequest } from './types';

export interface LiveKitConfig { url: string; apiKey: string; apiSecret: string }

export async function livekitJoin(cfg: LiveKitConfig, req: JoinRequest): Promise<JoinInfo> {
  const host = cfg.url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  try {
    await new RoomServiceClient(host, cfg.apiKey, cfg.apiSecret).createRoom({
      name: req.room,
      maxParticipants: 2,
      emptyTimeout: 300,
    });
  } catch {
    throw new ProviderFailed('livekit', 'create_room');
  }

  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: req.identity,
    name: req.displayName,
    ttl: req.ttlSeconds,
  });
  at.addGrant({ room: req.room, roomJoin: true, canPublish: true, canSubscribe: true });

  return {
    provider: 'livekit',
    url: cfg.url,
    token: await at.toJwt(),
    expiresAt: new Date(req.now.getTime() + req.ttlSeconds * 1000).toISOString(),
  };
}
```

`src/video/index.ts`:
```ts
import { dailyJoin } from './daily';
import { livekitJoin } from './livekit';
import { ProviderUnconfigured, type JoinInfo, type JoinRequest, type VideoProvider } from './types';

export * from './types';

export interface VideoEnv {
  DAILY_API_KEY?: string;
  DAILY_DOMAIN?: string;
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}

export async function createJoin(provider: VideoProvider, env: VideoEnv, req: JoinRequest): Promise<JoinInfo> {
  if (provider === 'daily') {
    const { DAILY_API_KEY: apiKey, DAILY_DOMAIN: domain } = env;
    if (!apiKey || !domain) throw new ProviderUnconfigured('daily');
    return dailyJoin({ apiKey, domain }, req);
  }
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = env;
  if (!url || !apiKey || !apiSecret) throw new ProviderUnconfigured('livekit');
  return livekitJoin({ url, apiKey, apiSecret }, req);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/video && npm run typecheck`
Expected: PASS (8 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/video tests/video
git commit -m "feat(video): Daily and LiveKit join tokens behind a provider layer, two-person rooms, no recording"
```

---

### Task 3: Call-test join API (access code + validation)

**Files:**
- Create: `src/call-test/join.ts`, `src/app/api/call-test/join/route.ts`
- Modify: `.env.example` (add `CALL_TEST_CODE`)
- Test: `tests/call-test/join.test.ts`, `tests/call-test/route.test.ts`

**Interfaces:**
- Consumes: `createJoin`, `VIDEO_PROVIDERS`, `ProviderUnconfigured`, `ProviderFailed`, `VideoEnv`, `VideoProvider`, `JoinInfo` from `@/video`; `mockFetch`, `jsonResponse` from `tests/video/fetch-mock.ts`.
- Produces:
  - `CALL_TEST_TTL_SECONDS = 7200`
  - `interface CallTestEnv extends VideoEnv { CALL_TEST_CODE?: string }`
  - `type CallTestError = 'disabled' | 'forbidden' | 'invalid_provider' | 'invalid_room' | 'invalid_name' | 'provider_unconfigured' | 'provider_failed'`
  - `handleCallTestJoin(input: unknown, env: CallTestEnv, now?: Date): Promise<{ status: 200; body: JoinInfo } | { status: 400 | 403 | 502 | 503; body: { error: CallTestError } }>`
  - `safeEqual(a: string, b: string): boolean`
  - HTTP: `POST /api/call-test/join` JSON `{ code, provider, room, name }` → the same status/body, header `Cache-Control: no-store`.

- [ ] **Step 1: Write the failing tests**

`tests/call-test/join.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleCallTestJoin, safeEqual } from '@/call-test/join';
import { jsonResponse, mockFetch } from '../video/fetch-mock';

const API = 'https://api.daily.co/v1';
const env = { CALL_TEST_CODE: 'open-sesame-42', DAILY_API_KEY: 'dk', DAILY_DOMAIN: 'thropy.daily.co' };
const good = { code: 'open-sesame-42', provider: 'daily', room: 'tehran-1', name: 'دکتر الف' };
const now = new Date('2026-10-14T17:00:00Z');

afterEach(() => vi.unstubAllGlobals());

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
```

`tests/call-test/route.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/call-test`
Expected: FAIL — cannot resolve `@/call-test/join` and the route module.

- [ ] **Step 3: Implement**

`src/call-test/join.ts`:
```ts
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
```

`src/app/api/call-test/join/route.ts`:
```ts
import { handleCallTestJoin } from '@/call-test/join';

export async function POST(request: Request): Promise<Response> {
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    // Not JSON: handled as an empty request, which fails the code check.
  }
  const { status, body } = await handleCallTestJoin(input, process.env);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
```

`.env.example` — append:
```
# Temporary call-test page (/call-test). Any long random string; share it only with testers.
# Leave empty to switch the page off.
CALL_TEST_CODE=
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/call-test && npm run typecheck`
Expected: PASS (10 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/call-test/join.ts src/app/api/call-test tests/call-test .env.example
git commit -m "feat(call-test): code-protected join endpoint with input validation"
```

---

### Task 4: Call report (event log → summary → text)

**Files:**
- Create: `src/call-test/report.ts`
- Test: `tests/call-test/report.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type CallEventKind = 'joined' | 'left' | 'reconnecting' | 'reconnected' | 'peer_joined' | 'peer_left'
    | 'quality_low' | 'quality_ok' | 'camera_off' | 'camera_on' | 'error';
  interface CallEvent { at: number; kind: CallEventKind; detail?: string }   // at = epoch ms
  const LONG_OUTAGE_MS = 30_000;
  interface CallSummary { startedAt: number | null; durationMs: number; outages: number; totalOutageMs: number;
    longestOutageMs: number; peerDrops: number; longestPeerGapMs: number; lowQualityMs: number;
    audioOnlyMs: number; errors: number; passed: boolean }
  summarizeCall(events: readonly CallEvent[], endAt: number): CallSummary
  type NetworkKind = 'home' | 'mci' | 'irancell' | 'other';
  type DeviceKind = 'laptop' | 'phone';
  interface ReportMeta { provider: string; room: string; tester: string; network: NetworkKind; device: DeviceKind;
    audioRating: number | null; videoRating: number | null; notes: string }
  formatReport(meta: ReportMeta, events: readonly CallEvent[], endAt: number): string
  formatDuration(ms: number): string   // "50m 10s"
  ```

Rules (from spec 10's criteria "calls finished without a long drop, reconnect speed"):
- Own outage = `reconnecting` → `reconnected`, or `left` → next `joined` (dropped out and came back). If they leave while reconnecting and never return, the outage ends when they left.
- Peer drop = `peer_left` → `peer_joined` after the peer had joined once. A peer gap still open at the end is the normal goodbye and is not counted (each side submits its own report).
- `quality_low`/`camera_off` spans close on their opposite event, on `left`, or at the end. Repeated opens don't double count.
- `passed` = call happened (`durationMs > 0`) and no own outage or peer gap ≥ `LONG_OUTAGE_MS`.

- [ ] **Step 1: Write the failing test**

`tests/call-test/report.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDuration, formatReport, summarizeCall, type CallEvent, type CallEventKind } from '@/call-test/report';

const t0 = Date.UTC(2026, 9, 14, 17, 33, 0); // 21:03 Tehran
const s = (n: number) => n * 1000;
const m = (n: number) => n * 60_000;
const ev = (at: number, kind: CallEventKind): CallEvent => ({ at: t0 + at, kind });

describe('summarizeCall', () => {
  it('clean 50-minute call: peer hanging up at the end is not a drop (Review Focus 4)', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(50), 'peer_left'), ev(m(50) + s(10), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ startedAt: t0, durationMs: m(50) + s(10), outages: 0, peerDrops: 0, passed: true });
  });

  it('a short reconnect is counted but passes', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(5), 'reconnected'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, totalOutageMs: s(5), longestOutageMs: s(5), passed: true });
  });

  it('a 45-second outage fails', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(45), 'reconnected'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, longestOutageMs: s(45), passed: false });
  });

  it('left while reconnecting and never came back (Review Focus 3)', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(20), 'reconnecting'), ev(m(21), 'left')], t0 + m(30));
    expect(out).toMatchObject({ durationMs: m(21), outages: 1, longestOutageMs: m(1), passed: false });
  });

  it('dropped out and rejoined: the gap is an outage', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(10), 'left'), ev(m(10) + s(20), 'joined'), ev(m(50), 'left')], t0 + m(60));
    expect(out).toMatchObject({ durationMs: m(50), outages: 1, longestOutageMs: s(20), passed: true });
  });

  it('reconnecting, then left, then rejoined is one outage', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(10), 'reconnecting'), ev(m(10) + s(30), 'left'), ev(m(11), 'joined'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ outages: 1, longestOutageMs: m(1), passed: false });
  });

  it('peer drop and return is counted', () => {
    const out = summarizeCall([
      ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(5), 'peer_left'), ev(m(5) + s(40), 'peer_joined'), ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out).toMatchObject({ peerDrops: 1, longestPeerGapMs: s(40), passed: false });
  });

  it('ignores reconnected without reconnecting (initial connect events)', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(s(1), 'reconnected'), ev(m(50), 'left')], t0 + m(60));
    expect(out.outages).toBe(0);
  });

  it('measures low quality and audio-only time without double counting', () => {
    const out = summarizeCall([
      ev(0, 'joined'),
      ev(m(5), 'quality_low'), ev(m(6), 'quality_low'), ev(m(8), 'quality_ok'),
      ev(m(10), 'camera_off'), ev(m(12), 'camera_on'),
      ev(m(40), 'camera_off'),
      ev(m(50), 'left'),
    ], t0 + m(60));
    expect(out.lowQualityMs).toBe(m(3));
    expect(out.audioOnlyMs).toBe(m(2) + m(10));
  });

  it('a call still in progress runs to endAt', () => {
    const out = summarizeCall([ev(0, 'joined'), ev(m(10), 'reconnecting')], t0 + m(10) + s(12));
    expect(out).toMatchObject({ durationMs: m(10) + s(12), outages: 1, longestOutageMs: s(12) });
  });

  it('sorts events and counts errors', () => {
    const out = summarizeCall([ev(m(50), 'left'), ev(m(3), 'error'), ev(0, 'joined')], t0 + m(60));
    expect(out).toMatchObject({ durationMs: m(50), errors: 1 });
  });

  it('never joined: zero duration, not passed', () => {
    expect(summarizeCall([ev(0, 'error')], t0 + m(1))).toMatchObject({ startedAt: null, durationMs: 0, passed: false });
  });
});

describe('formatDuration', () => {
  it('minutes and whole seconds', () => {
    expect(formatDuration(0)).toBe('0m 0s');
    expect(formatDuration(61_500)).toBe('1m 1s');
    expect(formatDuration(m(50) + s(10))).toBe('50m 10s');
  });
});

describe('formatReport', () => {
  it('plain text with Tehran start time, ratings and result', () => {
    const text = formatReport(
      { provider: 'daily', room: 'tehran-1', tester: 'دکتر الف', network: 'mci', device: 'phone', audioRating: 4, videoRating: null, notes: 'خوب بود' },
      [ev(0, 'joined'), ev(m(1), 'peer_joined'), ev(m(50), 'peer_left'), ev(m(50) + s(10), 'left')],
      t0 + m(60),
    );
    expect(text).toContain('provider: daily');
    expect(text).toContain('network: mci');
    expect(text).toContain('started (Tehran): 2026-10-14 21:03');
    expect(text).toContain('duration: 50m 10s');
    expect(text).toContain('own outages: 0 (total 0m 0s, longest 0m 0s)');
    expect(text).toContain('audio rating: 4/5');
    expect(text).toContain('video rating: —');
    expect(text).toContain('result: PASS');
    expect(text).toContain('notes: خوب بود');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/call-test/report.test.ts`
Expected: FAIL — cannot resolve `@/call-test/report`.

- [ ] **Step 3: Implement**

`src/call-test/report.ts`:
```ts
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export type CallEventKind =
  | 'joined' | 'left' | 'reconnecting' | 'reconnected'
  | 'peer_joined' | 'peer_left' | 'quality_low' | 'quality_ok'
  | 'camera_off' | 'camera_on' | 'error';

export interface CallEvent { at: number; kind: CallEventKind; detail?: string } // at = epoch ms

export const LONG_OUTAGE_MS = 30_000;

export interface CallSummary {
  startedAt: number | null;
  durationMs: number;
  outages: number;
  totalOutageMs: number;
  longestOutageMs: number;
  peerDrops: number;
  longestPeerGapMs: number;
  lowQualityMs: number;
  audioOnlyMs: number;
  errors: number;
  passed: boolean;
}

/** A span that opens once and closes once; repeated opens are ignored. */
class Span {
  private start: number | null = null;
  readonly closed: number[] = [];
  get isOpen(): boolean { return this.start !== null; }
  open(at: number): void { this.start ??= at; }
  close(at: number): void {
    if (this.start === null) return;
    this.closed.push(at - this.start);
    this.start = null;
  }
  total(): number { return this.closed.reduce((a, b) => a + b, 0); }
  longest(): number { return Math.max(0, ...this.closed); }
}

export function summarizeCall(events: readonly CallEvent[], endAt: number): CallSummary {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const outage = new Span();
  const peerGap = new Span();
  const low = new Span();
  const cameraOff = new Span();
  let startedAt: number | null = null;
  let inCall = false;
  let lastLeft: number | null = null;
  let peerSeen = false;
  let errors = 0;

  for (const e of sorted) {
    switch (e.kind) {
      case 'joined':
        startedAt ??= e.at;
        if (lastLeft !== null && !outage.isOpen) outage.open(lastLeft); // dropped out and came back
        outage.close(e.at);
        inCall = true;
        break;
      case 'left':
        inCall = false;
        lastLeft = e.at;
        low.close(e.at);
        cameraOff.close(e.at);
        break;
      case 'reconnecting': if (inCall) outage.open(e.at); break;
      case 'reconnected': outage.close(e.at); break;
      case 'peer_joined': peerSeen = true; peerGap.close(e.at); break;
      case 'peer_left': if (peerSeen) peerGap.open(e.at); break;
      case 'quality_low': if (inCall) low.open(e.at); break;
      case 'quality_ok': low.close(e.at); break;
      case 'camera_off': if (inCall) cameraOff.open(e.at); break;
      case 'camera_on': cameraOff.close(e.at); break;
      case 'error': errors += 1; break;
    }
  }

  const finalAt = inCall ? endAt : (lastLeft ?? endAt);
  outage.close(finalAt);
  low.close(finalAt);
  cameraOff.close(finalAt);
  // A peer gap still open here is the normal goodbye; a real drop shows in the peer's own report.

  const durationMs = startedAt === null ? 0 : finalAt - startedAt;
  return {
    startedAt,
    durationMs,
    outages: outage.closed.length,
    totalOutageMs: outage.total(),
    longestOutageMs: outage.longest(),
    peerDrops: peerGap.closed.length,
    longestPeerGapMs: peerGap.longest(),
    lowQualityMs: low.total(),
    audioOnlyMs: cameraOff.total(),
    errors,
    passed: durationMs > 0 && Math.max(outage.longest(), peerGap.longest()) < LONG_OUTAGE_MS,
  };
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export type NetworkKind = 'home' | 'mci' | 'irancell' | 'other';
export type DeviceKind = 'laptop' | 'phone';

export interface ReportMeta {
  provider: string;
  room: string;
  tester: string;
  network: NetworkKind;
  device: DeviceKind;
  audioRating: number | null;
  videoRating: number | null;
  notes: string;
}

const rating = (r: number | null) => (r === null ? '—' : `${r}/5`);

export function formatReport(meta: ReportMeta, events: readonly CallEvent[], endAt: number): string {
  const s = summarizeCall(events, endAt);
  const started = s.startedAt === null ? '—' : format(new TZDate(s.startedAt, 'Asia/Tehran'), 'yyyy-MM-dd HH:mm');
  return [
    'TropiFarsi call test',
    `provider: ${meta.provider}`,
    `room: ${meta.room}`,
    `tester: ${meta.tester}`,
    `network: ${meta.network}`,
    `device: ${meta.device}`,
    `started (Tehran): ${started}`,
    `duration: ${formatDuration(s.durationMs)}`,
    `own outages: ${s.outages} (total ${formatDuration(s.totalOutageMs)}, longest ${formatDuration(s.longestOutageMs)})`,
    `peer drops: ${s.peerDrops} (longest ${formatDuration(s.longestPeerGapMs)})`,
    `low network quality: ${formatDuration(s.lowQualityMs)}`,
    `audio only: ${formatDuration(s.audioOnlyMs)}`,
    `errors: ${s.errors}`,
    `audio rating: ${rating(meta.audioRating)}`,
    `video rating: ${rating(meta.videoRating)}`,
    `result: ${s.passed ? 'PASS' : 'FAIL'}`,
    `notes: ${meta.notes.trim() || '—'}`,
  ].join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/call-test/report.test.ts && npm run typecheck`
Expected: PASS (14 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/call-test/report.ts tests/call-test/report.test.ts
git commit -m "feat(call-test): call event summary and copyable report"
```

---

### Task 5: Call-test page (form → call → report)

**Files:**
- Create: `src/app/call-test/page.tsx`, `src/app/call-test/CallTestClient.tsx`, `src/app/call-test/call-view.ts`, `src/app/call-test/DailyCallView.tsx`, `src/app/call-test/LiveKitCallView.tsx`, `src/app/call-test/ReportPanel.tsx`
- Modify: `messages/fa.json`, `messages/en.json` (add `callTest`), `src/app/globals.css` (append call-test styles)
- Test: `tests/i18n/messages.test.ts` (already enforces key parity — must stay green); manual browser check.

**Interfaces:**
- Consumes: `POST /api/call-test/join` (Task 3); `JoinInfo`, `VideoProvider`, `VIDEO_PROVIDERS` from `@/video/types` (never `@/video` — that pulls the server SDK into the browser); `formatReport`, `CallEvent`, `CallEventKind`, `NetworkKind`, `DeviceKind` from `@/call-test/report`.
- Produces: page `/call-test`.

- [ ] **Step 1: Add messages**

Replace `messages/fa.json`:
```json
{
  "meta": { "title": "تراپی‌فارسی", "description": "مشاوره و روان‌درمانی آنلاین به زبان فارسی" },
  "home": { "brand": "تراپی‌فارسی", "soon": "به‌زودی. سایت در حال ساخت است." },
  "callTest": {
    "title": "تست تماس",
    "intro": "این صفحه موقت است و فقط برای سنجیدن کیفیت تماس از ایران ساخته شده. تماس ضبط نمی‌شود و چیزی روی سرور ذخیره نمی‌شود.",
    "code": "کد دسترسی",
    "provider": "سرویس تماس",
    "room": "اسم اتاق",
    "roomHint": "فقط حروف کوچک انگلیسی، عدد و خط تیره، ۳ تا ۴۰ حرف. هر دو نفر باید همین اسم را بزنند.",
    "name": "اسم شما",
    "network": "اینترنت",
    "networkHome": "اینترنت خانه",
    "networkMci": "موبایل همراه اول",
    "networkIrancell": "موبایل ایرانسل",
    "networkOther": "سایر",
    "device": "دستگاه",
    "deviceLaptop": "لپ‌تاپ",
    "devicePhone": "گوشی",
    "join": "ورود به تماس",
    "joining": "در حال آماده شدن…",
    "inCall": "در تماس: {provider} / {room}",
    "leaveHint": "برای پایان تماس، دکمهٔ خروج داخل تماس را بزنید. بعد گزارش ساخته می‌شود.",
    "log": "رویدادها",
    "reportTitle": "گزارش این تماس",
    "reportHint": "امتیاز بدهید، گزارش را کپی کنید و برای صاحب سایت بفرستید.",
    "audioRating": "کیفیت صدا",
    "videoRating": "کیفیت تصویر",
    "notRated": "بدون امتیاز",
    "notes": "توضیح (اختیاری)",
    "copy": "کپی گزارش",
    "copied": "کپی شد",
    "again": "تماس تازه",
    "events": {
      "joined": "وصل شد",
      "left": "خارج شد",
      "reconnecting": "قطع شد، در حال وصل شدن دوباره",
      "reconnected": "دوباره وصل شد",
      "peer_joined": "طرف مقابل وارد شد",
      "peer_left": "طرف مقابل خارج شد",
      "quality_low": "کیفیت شبکه پایین",
      "quality_ok": "کیفیت شبکه خوب",
      "camera_off": "دوربین خاموش (فقط صدا)",
      "camera_on": "دوربین روشن",
      "error": "خطا"
    },
    "errors": {
      "disabled": "صفحهٔ تست الان خاموش است.",
      "forbidden": "کد دسترسی درست نیست.",
      "invalid_provider": "سرویس تماس را انتخاب کنید.",
      "invalid_room": "اسم اتاق درست نیست. فقط حروف کوچک انگلیسی، عدد و خط تیره.",
      "invalid_name": "اسم خود را بنویسید (حداکثر ۴۰ حرف).",
      "provider_unconfigured": "این سرویس هنوز تنظیم نشده.",
      "provider_failed": "سرویس تماس جواب نداد. چند لحظه بعد دوباره امتحان کنید.",
      "network": "اتصال به سایت برقرار نشد.",
      "unknown": "خطای ناشناخته."
    }
  }
}
```

Replace `messages/en.json`:
```json
{
  "meta": { "title": "TropiFarsi", "description": "Online counselling and psychotherapy in Persian" },
  "home": { "brand": "TropiFarsi", "soon": "Coming soon. The site is being built." },
  "callTest": {
    "title": "Call test",
    "intro": "This is a temporary page for measuring call quality from Iran. Calls are not recorded and nothing is stored on the server.",
    "code": "Access code",
    "provider": "Call service",
    "room": "Room name",
    "roomHint": "Lowercase English letters, digits and dashes only, 3–40 characters. Both people must type the same name.",
    "name": "Your name",
    "network": "Internet",
    "networkHome": "Home internet",
    "networkMci": "Mobile – Hamrah-e Aval",
    "networkIrancell": "Mobile – Irancell",
    "networkOther": "Other",
    "device": "Device",
    "deviceLaptop": "Laptop",
    "devicePhone": "Phone",
    "join": "Join call",
    "joining": "Getting ready…",
    "inCall": "In call: {provider} / {room}",
    "leaveHint": "To end the call, press the leave button inside the call. The report is built after that.",
    "log": "Events",
    "reportTitle": "Report for this call",
    "reportHint": "Rate the call, copy the report and send it to the site owner.",
    "audioRating": "Audio quality",
    "videoRating": "Video quality",
    "notRated": "Not rated",
    "notes": "Notes (optional)",
    "copy": "Copy report",
    "copied": "Copied",
    "again": "New call",
    "events": {
      "joined": "Connected",
      "left": "Left",
      "reconnecting": "Dropped, reconnecting",
      "reconnected": "Reconnected",
      "peer_joined": "Other person joined",
      "peer_left": "Other person left",
      "quality_low": "Network quality low",
      "quality_ok": "Network quality good",
      "camera_off": "Camera off (audio only)",
      "camera_on": "Camera on",
      "error": "Error"
    },
    "errors": {
      "disabled": "The test page is switched off.",
      "forbidden": "Wrong access code.",
      "invalid_provider": "Choose a call service.",
      "invalid_room": "Invalid room name. Lowercase English letters, digits and dashes only.",
      "invalid_name": "Type your name (40 characters max).",
      "provider_unconfigured": "This service is not set up yet.",
      "provider_failed": "The call service did not answer. Try again in a moment.",
      "network": "Could not reach the site.",
      "unknown": "Unknown error."
    }
  }
}
```

Run: `npx vitest run tests/i18n`
Expected: PASS.

- [ ] **Step 2: Append call-test styles to `src/app/globals.css`**

```css
.card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 20px; }
.form { display: grid; gap: 14px; max-width: 520px; }
.field { display: grid; gap: 4px; }
.field input, .field select, .field textarea {
  font: inherit; padding: 8px 10px; border: 1px solid var(--line);
  border-radius: var(--radius-s); background: var(--surface); color: var(--ink);
}
.hint { font-size: 0.85rem; color: var(--muted); }
.btn {
  font: inherit; padding: 10px 18px; border: 0; border-radius: var(--radius-s);
  background: var(--firouzeh); color: #fff; cursor: pointer; justify-self: start;
}
.btn:hover { background: var(--firouzeh-dark); }
.btn:disabled { opacity: 0.6; cursor: progress; }
.btn-quiet { background: transparent; color: var(--cypress); border: 1px solid var(--line); }
.btn-quiet:hover { background: var(--bg); }
.error { color: var(--anar); margin: 0; }
.call-frame { width: 100%; height: min(72vh, 680px); border-radius: var(--radius-s); overflow: hidden; background: #111; }
.log { font-size: 0.85rem; color: var(--muted); padding-inline-start: 20px; }
.report { width: 100%; min-height: 300px; font-family: ui-monospace, monospace; font-size: 0.85rem; }
.row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
```

- [ ] **Step 3: Write the page and shared props**

`src/app/call-test/page.tsx`:
```tsx
import type { Metadata } from 'next';
import { CallTestClient } from './CallTestClient';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CallTestPage() {
  return <CallTestClient />;
}
```

`src/app/call-test/call-view.ts`:
```ts
import type { CallEventKind } from '@/call-test/report';

export interface CallViewProps {
  url: string;
  token: string;
  displayName: string;
  onEvent: (kind: CallEventKind, detail?: string) => void;
  onLeave: () => void;
}
```

- [ ] **Step 4: Write the Daily view**

`src/app/call-test/DailyCallView.tsx`:
```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { DailyCall } from '@daily-co/daily-js';
import type { CallViewProps } from './call-view';

export function DailyCallView({ url, token, onEvent, onLeave }: CallViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef({ onEvent, onLeave });
  useEffect(() => { cb.current = { onEvent, onLeave }; });

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    const emit: CallViewProps['onEvent'] = (kind, detail) => cb.current.onEvent(kind, detail);
    let quality: 'quality_ok' | 'quality_low' | null = null;
    let cameraOff = false;

    void (async () => {
      const Daily = (await import('@daily-co/daily-js')).default;
      if (cancelled || !box.current) return;
      call = Daily.createFrame(box.current, {
        iframeStyle: { width: '100%', height: '100%', border: '0' },
        showLeaveButton: true,
        allowMultipleCallInstances: true,
      });
      call
        .on('joined-meeting', () => emit('joined'))
        .on('left-meeting', () => { emit('left'); cb.current.onLeave(); })
        .on('participant-joined', () => emit('peer_joined'))
        .on('participant-left', () => emit('peer_left'))
        .on('network-connection', (e) => {
          if (e?.event === 'interrupted') emit('reconnecting', e.type);
          else if (e?.event === 'connected') emit('reconnected', e.type);
        })
        .on('network-quality-change', (e) => {
          // Newer daily-js reports networkState; older versions report threshold.
          const raw = e as unknown as { networkState?: string; threshold?: string } | undefined;
          const level = raw?.networkState ?? raw?.threshold;
          if (!level || level === 'unknown') return;
          const next = level === 'good' ? 'quality_ok' : 'quality_low';
          if (next !== quality) { quality = next; emit(next, level); }
        })
        .on('participant-updated', (e) => {
          if (!e?.participant.local) return;
          const state = e.participant.tracks.video.state;
          if (state !== 'off' && state !== 'playable') return;
          const off = state === 'off';
          if (off !== cameraOff) { cameraOff = off; emit(off ? 'camera_off' : 'camera_on'); }
        })
        .on('error', (e) => emit('error', e?.errorMsg));
      await call.join({ url, token });
    })().catch((err: unknown) => emit('error', String(err)));

    return () => {
      cancelled = true;
      void call?.destroy();
    };
  }, [url, token]);

  return <div ref={box} className="call-frame" />;
}
```

> If a daily-js event payload type differs from what is used here, narrow with the smallest cast that keeps the same behaviour; do not drop an event.

- [ ] **Step 5: Write the LiveKit view**

`src/app/call-test/LiveKitCallView.tsx`:
```tsx
'use client';

import '@livekit/components-styles';
import { useEffect, useRef, useState } from 'react';
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from '@livekit/components-react';
import {
  ConnectionQuality, Room, RoomEvent, Track,
  type DisconnectReason, type Participant, type TrackPublication,
} from 'livekit-client';
import type { CallViewProps } from './call-view';

export function LiveKitCallView({ url, token, displayName, onEvent, onLeave }: CallViewProps) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);
  const cb = useRef({ onEvent, onLeave });
  useEffect(() => { cb.current = { onEvent, onLeave }; });

  useEffect(() => {
    const emit: CallViewProps['onEvent'] = (kind, detail) => cb.current.onEvent(kind, detail);
    let quality: 'quality_ok' | 'quality_low' | null = null;

    const onConnected = () => emit('joined');
    const onDisconnected = (reason?: DisconnectReason) => {
      emit('left', reason === undefined ? undefined : String(reason));
      cb.current.onLeave();
    };
    const onReconnecting = () => emit('reconnecting');
    const onReconnected = () => emit('reconnected');
    const onPeerJoined = () => emit('peer_joined');
    const onPeerLeft = () => emit('peer_left');
    const onQuality = (q: ConnectionQuality, p: Participant) => {
      if (!p.isLocal || q === ConnectionQuality.Unknown) return;
      const next = q === ConnectionQuality.Excellent || q === ConnectionQuality.Good ? 'quality_ok' : 'quality_low';
      if (next !== quality) { quality = next; emit(next, q); }
    };
    const onMuted = (pub: TrackPublication, p: Participant) => {
      if (p.isLocal && pub.source === Track.Source.Camera) emit('camera_off');
    };
    const onUnmuted = (pub: TrackPublication, p: Participant) => {
      if (p.isLocal && pub.source === Track.Source.Camera) emit('camera_on');
    };
    const onMediaError = (e: Error) => emit('error', e.message);

    room
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onReconnected)
      .on(RoomEvent.ParticipantConnected, onPeerJoined)
      .on(RoomEvent.ParticipantDisconnected, onPeerLeft)
      .on(RoomEvent.ConnectionQualityChanged, onQuality)
      .on(RoomEvent.TrackMuted, onMuted)
      .on(RoomEvent.TrackUnmuted, onUnmuted)
      .on(RoomEvent.MediaDevicesError, onMediaError);

    return () => {
      // Remove only our listeners (LiveKitRoom has its own), then leave.
      room
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.Reconnecting, onReconnecting)
        .off(RoomEvent.Reconnected, onReconnected)
        .off(RoomEvent.ParticipantConnected, onPeerJoined)
        .off(RoomEvent.ParticipantDisconnected, onPeerLeft)
        .off(RoomEvent.ConnectionQualityChanged, onQuality)
        .off(RoomEvent.TrackMuted, onMuted)
        .off(RoomEvent.TrackUnmuted, onUnmuted)
        .off(RoomEvent.MediaDevicesError, onMediaError);
      void room.disconnect();
    };
  }, [room]);

  // Device check before joining (spec 4-7).
  if (!choices) {
    return (
      <div className="call-frame" data-lk-theme="default">
        <PreJoin defaults={{ username: displayName }} onSubmit={setChoices} persistUserChoices={false} />
      </div>
    );
  }

  return (
    <LiveKitRoom
      room={room}
      serverUrl={url}
      token={token}
      connect
      video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
      audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
      data-lk-theme="default"
      className="call-frame"
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
```

- [ ] **Step 6: Write the report panel**

`src/app/call-test/ReportPanel.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatReport, type CallEvent, type ReportMeta } from '@/call-test/report';

type Base = Omit<ReportMeta, 'audioRating' | 'videoRating' | 'notes'>;

interface Props { base: Base; events: readonly CallEvent[]; endedAt: number; onAgain: () => void }

const RATINGS = [1, 2, 3, 4, 5];

export function ReportPanel({ base, events, endedAt, onAgain }: Props) {
  const t = useTranslations('callTest');
  const [audio, setAudio] = useState<number | null>(null);
  const [video, setVideo] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [copied, setCopied] = useState(false);
  const text = formatReport({ ...base, audioRating: audio, videoRating: video, notes }, events, endedAt);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // the textarea stays selectable for manual copy
    }
  }

  const ratingSelect = (label: string, value: number | null, set: (v: number | null) => void) => (
    <label className="field">
      {label}
      <select value={value ?? ''} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{t('notRated')}</option>
        {RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </label>
  );

  return (
    <section className="card form">
      <h2>{t('reportTitle')}</h2>
      <p className="hint">{t('reportHint')}</p>
      {ratingSelect(t('audioRating'), audio, setAudio)}
      {ratingSelect(t('videoRating'), video, setVideo)}
      <label className="field">
        {t('notes')}
        <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setCopied(false); }} rows={3} />
      </label>
      <textarea className="report" readOnly value={text} dir="ltr" />
      <div className="row">
        <button type="button" className="btn" onClick={copy}>{copied ? t('copied') : t('copy')}</button>
        <button type="button" className="btn btn-quiet" onClick={onAgain}>{t('again')}</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Write the client controller**

`src/app/call-test/CallTestClient.tsx`:
```tsx
'use client';

import { useCallback, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { VIDEO_PROVIDERS, type JoinInfo, type VideoProvider } from '@/video/types';
import type { CallEvent, CallEventKind, DeviceKind, NetworkKind } from '@/call-test/report';
import { ReportPanel } from './ReportPanel';

const DailyCallView = dynamic(() => import('./DailyCallView').then((m) => m.DailyCallView), { ssr: false });
const LiveKitCallView = dynamic(() => import('./LiveKitCallView').then((m) => m.LiveKitCallView), { ssr: false });

const PROVIDER_LABEL: Record<VideoProvider, string> = { daily: 'Daily', livekit: 'LiveKit' };
const NETWORKS: NetworkKind[] = ['home', 'mci', 'irancell', 'other'];
const NETWORK_KEY = { home: 'networkHome', mci: 'networkMci', irancell: 'networkIrancell', other: 'networkOther' } as const;
const KNOWN_ERRORS = [
  'disabled', 'forbidden', 'invalid_provider', 'invalid_room', 'invalid_name',
  'provider_unconfigured', 'provider_failed', 'network',
] as const;

type Stage =
  | { kind: 'form' }
  | { kind: 'call'; join: JoinInfo }
  | { kind: 'report'; join: JoinInfo; endedAt: number };

interface FormState {
  code: string;
  provider: VideoProvider;
  room: string;
  name: string;
  network: NetworkKind;
  device: DeviceKind;
}

const errorKey = (e: unknown): string => ((KNOWN_ERRORS as readonly unknown[]).includes(e) ? (e as string) : 'unknown');

export function CallTestClient() {
  const t = useTranslations('callTest');
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [form, setForm] = useState<FormState>({ code: '', provider: 'daily', room: '', name: '', network: 'home', device: 'laptop' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<CallEvent[]>([]);

  const onEvent = useCallback((kind: CallEventKind, detail?: string) => {
    setEvents((prev) => [...prev, { at: Date.now(), kind, detail }]);
  }, []);
  const onLeave = useCallback(() => {
    setStage((s) => (s.kind === 'call' ? { kind: 'report', join: s.join, endedAt: Date.now() } : s));
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const room = form.room.trim().toLowerCase();
    set('room', room);
    try {
      const res = await fetch('/api/call-test/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: form.code, provider: form.provider, room, name: form.name }),
      });
      const body = (await res.json()) as JoinInfo | { error?: string };
      if (!res.ok || !('token' in body)) {
        setError(errorKey('error' in body ? body.error : undefined));
        return;
      }
      setEvents([]);
      setStage({ kind: 'call', join: body });
    } catch {
      setError('network');
    } finally {
      setBusy(false);
    }
  }

  if (stage.kind === 'report') {
    return (
      <main className="page">
        <ReportPanel
          base={{ provider: stage.join.provider, room: form.room, tester: form.name.trim(), network: form.network, device: form.device }}
          events={events}
          endedAt={stage.endedAt}
          onAgain={() => setStage({ kind: 'form' })}
        />
      </main>
    );
  }

  if (stage.kind === 'call') {
    const View = stage.join.provider === 'daily' ? DailyCallView : LiveKitCallView;
    return (
      <main className="page">
        <p className="muted">{t('inCall', { provider: PROVIDER_LABEL[stage.join.provider], room: form.room })}</p>
        <div dir="ltr">
          <View url={stage.join.url} token={stage.join.token} displayName={form.name.trim()} onEvent={onEvent} onLeave={onLeave} />
        </div>
        <p className="hint">{t('leaveHint')}</p>
        <h2>{t('log')}</h2>
        <ol className="log">
          {events.slice(-10).map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {new Date(e.at).toLocaleTimeString()} — {t(`events.${e.kind}`)}{e.detail ? ` (${e.detail})` : ''}
            </li>
          ))}
        </ol>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="brand">{t('title')}</h1>
      <p className="muted">{t('intro')}</p>
      <form className="card form" onSubmit={join}>
        <label className="field">
          {t('code')}
          <input type="password" autoComplete="off" required value={form.code} onChange={(e) => set('code', e.target.value)} />
        </label>
        <label className="field">
          {t('provider')}
          <select value={form.provider} onChange={(e) => set('provider', e.target.value as VideoProvider)}>
            {VIDEO_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="field">
          {t('room')}
          <input dir="ltr" required autoCapitalize="none" autoCorrect="off" value={form.room} onChange={(e) => set('room', e.target.value)} />
          <span className="hint">{t('roomHint')}</span>
        </label>
        <label className="field">
          {t('name')}
          <input required maxLength={40} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          {t('network')}
          <select value={form.network} onChange={(e) => set('network', e.target.value as NetworkKind)}>
            {NETWORKS.map((n) => <option key={n} value={n}>{t(NETWORK_KEY[n])}</option>)}
          </select>
        </label>
        <label className="field">
          {t('device')}
          <select value={form.device} onChange={(e) => set('device', e.target.value as DeviceKind)}>
            <option value="laptop">{t('deviceLaptop')}</option>
            <option value="phone">{t('devicePhone')}</option>
          </select>
        </label>
        {error && <p className="error" role="alert">{t(`errors.${error}`)}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? t('joining') : t('join')}</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Verify tests, types and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass; typecheck clean; build lists `/call-test` and `/api/call-test/join`.

- [ ] **Step 9: Check the page in the browser**

Put a test code in `.env.local` (create it if missing; never commit it): `CALL_TEST_CODE=local-test-code`. Start `npm run dev` and open `http://localhost:3000/call-test` in the browser pane.

Check, in order:
1. Page is right-to-left, Vazirmatn, Persian labels; `<meta name="robots" content="noindex, nofollow">` is in the HTML.
2. Submit with code `wrong` → red message «کد دسترسی درست نیست.»
3. Correct code, room `Tehran 1` → client lowercases to `tehran 1`, server rejects → «اسم اتاق درست نیست…».
4. Correct code, room `tehran-1`:
   - If `.env.local` has no Daily/LiveKit keys → «این سرویس هنوز تنظیم نشده.» for that provider. That is the expected result without keys.
   - If keys are present → open a second tab with the same room and provider; both reach the device check, then the call; the event list shows «وصل شد» and «طرف مقابل وارد شد»; turning the camera off logs «دوربین خاموش (فقط صدا)»; leaving shows the report with `result: PASS`, and «کپی گزارش» copies it. Repeat for the other provider.

Stop the dev server.

- [ ] **Step 10: Commit**

```bash
git add messages src/app/call-test src/app/globals.css
git commit -m "feat(call-test): call-test page with Daily and LiveKit views, live event log and report"
```

---

### Task 6: Deploy config + Persian test protocol

**Files:**
- Create: `.node-version`, `docs/call-test/README.md`
- Modify: `wrangler.jsonc` (custom domain)

**Interfaces:**
- Consumes: everything above.
- Produces: a deployable Worker config and the protocol the owner runs for step 0-A.

- [ ] **Step 1: Node version and custom domain**

`.node-version`:
```
24
```

`wrangler.jsonc` — add after `"observability"`:
```jsonc
  ,
  "routes": [{ "pattern": "tropifarsi.com", "custom_domain": true }]
```
(Result: the `routes` key sits at top level next to `assets` and `observability`; keep the file valid JSONC.)

- [ ] **Step 2: Write `docs/call-test/README.md`**

````markdown
# تست تماس از ایران (قدم ۰-الف)

این صفحه موقت است. بعد از گرفتن نتیجه، صفحه و مسیر `/api/call-test` پاک می‌شوند (بخش ۱۰ طرح).

## ۱. راه‌اندازی (یک بار، توسط صاحب سایت)

ساخت نهایی روی ویندوز کار نمی‌کند (باگ OpenNext روی ویندوز). ساخت و انتشار را Cloudflare روی لینوکس انجام می‌دهد:

1. یک مخزن **خصوصی** در GitHub بسازید و همین پروژه را push کنید.
2. در داشبورد Cloudflare: **Workers & Pages → Create → Import a repository** و همین مخزن را انتخاب کنید.
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
3. در **Settings → Variables and Secrets** این‌ها را به‌صورت Secret بگذارید:
   `CALL_TEST_CODE`، `DAILY_API_KEY`، `DAILY_DOMAIN`، `LIVEKIT_URL`، `LIVEKIT_API_KEY`، `LIVEKIT_API_SECRET`.
   `CALL_TEST_CODE` یک رشتهٔ تصادفی بلند است و فقط به تست‌کننده‌ها داده می‌شود.
4. دامنه: فایل `wrangler.jsonc` ورکر را روی `tropifarsi.com` می‌گذارد. اگر Cloudflare گفت رکورد DNS از قبل هست، رکورد قبلیِ `tropifarsi.com` را (فقط اگر چیزی رویش نیست) پاک کنید و دوباره deploy کنید.
   آدرس `*.workers.dev` را برای تست از ایران استفاده نکنید؛ ممکن است فیلتر باشد.
5. **Security → Bots:** حالت Bot Fight Mode و Under Attack خاموش باشد، تا دکتر داخل ایران پشت چالش Cloudflare گیر نکند.
6. داشبورد Daily: ضبط (recording) روی دامنه خاموش باشد. LiveKit Cloud: Egress راه نیندازید.

بررسی بعد از انتشار:
- `https://tropifarsi.com/` باز شود و فارسی و راست‌به‌چپ باشد.
- در `https://tropifarsi.com/call-test` با کد غلط پیام «کد دسترسی درست نیست» بیاید.
- با کد درست، دو تب، یک اتاق: تماس وصل شود.

## ۲. برنامهٔ تست

هر تماس **۵۰ دقیقه**، بین صاحب سایت (بیرون از ایران) و یک دکتر (داخل ایران). هر دو نفر صفحه را جدا باز می‌کنند، یک اسم اتاق می‌زنند، و آخر تماس **هر دو** گزارش را کپی می‌کنند.

حداقل برای **هر سرویس** (Daily و LiveKit):

| # | ساعت تهران | اینترنت دکتر | دستگاه دکتر |
|---|---|---|---|
| ۱ | حدود ۲۱ | خانه | لپ‌تاپ |
| ۲ | حدود ۲۱ | همراه اول | گوشی |
| ۳ | حدود ۲۱ | ایرانسل | گوشی |
| ۴ | حدود ۲۱ | خانه | گوشی |
| ۵ | وسط روز | یکی از بالا | هر کدام |

داخل هر تماس:
- دقیقهٔ ۱۰: دکتر دوربین را ۲ دقیقه خاموش کند (حالت فقط صدا) و بعد روشن کند.
- دقیقهٔ ۲۰: قطع عمدی. روی گوشی ۱۰ ثانیه حالت هواپیما؛ روی لپ‌تاپ ۱۰ ثانیه وای‌فای خاموش. ببینید چقدر طول می‌کشد دوباره وصل شود.
- دقیقهٔ ۳۰ تا ۵۰: گفتگوی عادی، مثل جلسهٔ واقعی.
- آخر: امتیاز صدا و تصویر، و یک جمله توضیح.

اگر شبکه UDP را ببندد، هر دو سرویس خودشان از TURN روی پورت ۴۴۳ استفاده می‌کنند. اگر در گزارش قطع طولانی دیدید، در توضیح بنویسید VPN روشن بود یا نه.

## ۳. معیار

یک تماس **قبول** است اگر گزارش هر دو نفر `result: PASS` باشد (هیچ قطعیِ ۳۰ ثانیه یا بیشتر) و امتیاز صدای دکتر ۴ یا ۵ باشد.

| سرویس | تماس قبول / کل | میانگین امتیاز صدا | طولانی‌ترین قطع | هزینهٔ تقریبی هر جلسه |
|---|---|---|---|---|
| Daily | | | | |
| LiveKit | | | | |

انتخاب: سرویسی که درصد تماس قبول بیشتری دارد؛ اگر برابر بودند، کیفیت صدا، بعد سرعت وصل شدن دوباره، بعد هزینه.

**شرط عبور قدم ۰-الف:** صاحب سایت و دکتر داخل ایران کتبی بگویند: «همین کیفیت برای جلسهٔ واقعی قابل تحمل است.» بدون این جمله، قدم ۱ شروع نمی‌شود.

اگر هیچ‌کدام قبول نشد: Cloudflare Realtime، و بعد LiveKit یا Jitsi روی سرور خودی، جداگانه سنجیده می‌شوند (بخش ۱۰).

## ۴. بعد از تست

- `CALL_TEST_CODE` را از Secrets پاک کنید (صفحه فوراً خاموش می‌شود: `503 disabled`).
- در پلن بعدی، پوشه‌های `src/app/call-test` و `src/app/api/call-test` و `src/call-test` پاک می‌شوند. لایهٔ `src/video` می‌ماند.
````

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck && npm run build && npm run cf:build`
Expected: all tests pass; typecheck clean; `next build` OK; `OpenNext build complete.`

- [ ] **Step 4: Commit**

```bash
git add .node-version wrangler.jsonc docs/call-test/README.md
git commit -m "docs(call-test): deploy runbook and step 0-A test protocol; Worker on tropifarsi.com"
```

---

## After this plan (owner, not the agent)

Push to a private GitHub repo, connect Cloudflare Workers Builds, set secrets, attach the domain (README section 1). These are outward-facing account actions, so the owner does them or explicitly approves each one.
