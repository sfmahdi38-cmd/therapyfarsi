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
