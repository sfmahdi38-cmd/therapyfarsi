'use client';

import '@livekit/components-styles';
import { useEffect, useRef, useState } from 'react';
import { LiveKitRoom, PreJoin, VideoConference, type LocalUserChoices } from '@livekit/components-react';
import {
  ConnectionQuality, Room, RoomEvent, Track,
  type DisconnectReason, type Participant, type TrackPublication,
} from 'livekit-client';
import type { CallViewProps } from './call-view';

export function LiveKitCallView({ url, token, displayName, forceRelay, onEvent, onLeave }: CallViewProps) {
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
      connectOptions={forceRelay ? { rtcConfig: { iceTransportPolicy: 'relay' } } : undefined}
      video={choices.videoEnabled ? { deviceId: choices.videoDeviceId } : false}
      audio={choices.audioEnabled ? { deviceId: choices.audioDeviceId } : false}
      data-lk-theme="default"
      className="call-frame"
    >
      <VideoConference />
    </LiveKitRoom>
  );
}
