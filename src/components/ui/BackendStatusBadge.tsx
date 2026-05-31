import { useBackendState, type SseStatus } from '@/store/backend-state-slice';

type StatusTone = 'online' | 'pending' | 'offline';

export interface BackendStatusView {
  tone: StatusTone;
  label: string;
}

/** Map the raw SSE connection status to a user-facing dot tone + short label. */
export function backendStatusView(status: SseStatus): BackendStatusView {
  switch (status) {
    case 'open':
      return { tone: 'online', label: 'Connected' };
    case 'connecting':
    case 'reconnecting':
      return { tone: 'pending', label: 'Connecting' };
    case 'idle':
    case 'closed':
    default:
      return { tone: 'offline', label: 'Offline' };
  }
}

const DOT_CLASS: Record<StatusTone, string> = {
  online: 'bg-emerald-400',
  pending: 'bg-amber-400 animate-pulse',
  offline: 'bg-text-secondary',
};

/** Backend connection indicator for the menu bar: a colored dot + short label. */
export function BackendStatusBadge() {
  const sseStatus = useBackendState((s) => s.sseStatus);
  const { tone, label } = backendStatusView(sseStatus);
  return (
    <div
      className="flex items-center gap-1.5 px-1.5 text-[10px] font-medium text-text-secondary select-none"
      role="status"
      aria-label={`Backend: ${label}`}
      title={`Backend connection: ${sseStatus}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASS[tone]}`} />
      <span>{label}</span>
    </div>
  );
}
