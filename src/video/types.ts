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
