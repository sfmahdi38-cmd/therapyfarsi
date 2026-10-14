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
