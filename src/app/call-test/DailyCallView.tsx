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
