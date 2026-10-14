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
