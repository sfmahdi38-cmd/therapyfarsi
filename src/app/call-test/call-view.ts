import type { CallEventKind } from '@/call-test/report';

export interface CallViewProps {
  url: string;
  token: string;
  displayName: string;
  onEvent: (kind: CallEventKind, detail?: string) => void;
  onLeave: () => void;
}
