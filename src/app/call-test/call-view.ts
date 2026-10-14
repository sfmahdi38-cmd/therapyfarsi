import type { CallEventKind } from '@/call-test/report';

export interface CallViewProps {
  url: string;
  token: string;
  displayName: string;
  forceRelay: boolean; // TURN over 443 only, to test the path used when UDP is blocked
  onEvent: (kind: CallEventKind, detail?: string) => void;
  onLeave: () => void;
}
