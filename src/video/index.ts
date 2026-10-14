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
