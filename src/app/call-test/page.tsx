import type { Metadata } from 'next';
import { CallTestClient } from './CallTestClient';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CallTestPage() {
  return <CallTestClient />;
}
