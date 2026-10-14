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
