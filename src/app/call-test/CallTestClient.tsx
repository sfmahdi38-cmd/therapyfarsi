'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { VIDEO_PROVIDERS, type JoinInfo, type VideoProvider } from '@/video/types';
import type { CallEvent, CallEventKind, DeviceKind, NetworkKind } from '@/call-test/report';
import { continueLog, loadSession, saveSession } from '@/call-test/session-log';
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
  forceRelay: boolean;
}

function tabStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const errorKey = (e: unknown): string => ((KNOWN_ERRORS as readonly unknown[]).includes(e) ? (e as string) : 'unknown');

export function CallTestClient() {
  const t = useTranslations('callTest');
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [form, setForm] = useState<FormState>({ code: '', provider: 'daily', room: '', name: '', network: 'home', device: 'laptop', forceRelay: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<CallEvent[]>([]);

  const onEvent = useCallback((kind: CallEventKind, detail?: string) => {
    setEvents((prev) => [...prev, { at: Date.now(), kind, detail }]);
  }, []);
  const onLeave = useCallback(() => {
    setStage((s) => (s.kind === 'call' ? { kind: 'report', join: s.join, endedAt: Date.now() } : s));
  }, []);

  // Keep this tab's log across reloads and rejoins, so a drop that forced one still shows in the report.
  useEffect(() => {
    if (stage.kind === 'form') return;
    saveSession(tabStorage(), { provider: stage.join.provider, room: form.room, events });
  }, [stage, events, form.room]);

  useEffect(() => {
    if (stage.kind !== 'call') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [stage.kind]);

  const endCall = () => {
    onEvent('left', 'ended_on_page');
    onLeave();
  };

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
      setEvents(continueLog(loadSession(tabStorage()), body.provider, room));
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
          base={{ provider: stage.join.provider, room: form.room, tester: form.name.trim(), network: form.network, device: form.device, relay: form.forceRelay ? 'forced' : 'auto' }}
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
          <View url={stage.join.url} token={stage.join.token} displayName={form.name.trim()} forceRelay={form.forceRelay} onEvent={onEvent} onLeave={onLeave} />
        </div>
        <div className="row">
          <p className="hint">{t('leaveHint')}</p>
          <button type="button" className="btn btn-quiet" onClick={endCall}>{t('endCall')}</button>
        </div>
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
        <label className="row">
          <input type="checkbox" checked={form.forceRelay} onChange={(e) => set('forceRelay', e.target.checked)} />
          <span>{t('forceRelay')}</span>
        </label>
        {error && <p className="error" role="alert">{t(`errors.${error}`)}</p>}
        <button type="submit" className="btn" disabled={busy}>{busy ? t('joining') : t('join')}</button>
      </form>
    </main>
  );
}
