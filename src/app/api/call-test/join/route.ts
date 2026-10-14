import { handleCallTestJoin, type CallTestEnv } from '@/call-test/join';

function readEnv(): CallTestEnv {
  const e = process.env;
  return {
    CALL_TEST_CODE: e.CALL_TEST_CODE,
    DAILY_API_KEY: e.DAILY_API_KEY,
    DAILY_DOMAIN: e.DAILY_DOMAIN,
    LIVEKIT_URL: e.LIVEKIT_URL,
    LIVEKIT_API_KEY: e.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: e.LIVEKIT_API_SECRET,
  };
}

export async function POST(request: Request): Promise<Response> {
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    // Not JSON: handled as an empty request, which fails the code check.
  }
  const { status, body } = await handleCallTestJoin(input, readEnv());
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
