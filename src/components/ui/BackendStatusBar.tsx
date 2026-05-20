import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2,
  Sparkles,
  CircleX,
  Info,
} from 'lucide-react';
import { useBackendStatus, type BackendStatus, type BackendStatusKind } from '@/hooks/useBackendStatus';

const COLORS: Record<BackendStatusKind, string> = {
  progress: 'text-text-secondary',
  success: 'text-emerald-400',
  info: 'text-text-secondary',
  error: 'text-red-400',
};

const STRIP_BG: Record<BackendStatusKind, string> = {
  progress: 'bg-surface-secondary',
  success: 'bg-emerald-500/10',
  info: 'bg-surface-secondary',
  error: 'bg-red-500/10',
};

function StatusContent({ status }: { status: BackendStatus }) {
  const Icon = status.kind === 'success' ? Sparkles
    : status.kind === 'progress' ? Loader2
    : status.kind === 'error' ? CircleX
    : Info;
  const spin = status.kind === 'progress';
  return (
    <>
      <Icon size={12} className={spin ? 'animate-spin shrink-0' : 'shrink-0'} />
      <span className="truncate">{status.text}</span>
    </>
  );
}

/**
 * Thin full-width strip under the toolbar that slides in when the backend has
 * something to say (progress, success, info, error) and slides out when idle.
 * Background is colour-coded; foreground reuses the docked-bar typography.
 */
export function BackendStatusBar() {
  const status = useBackendStatus();
  return (
    <AnimatePresence initial={false}>
      {status && (
        <motion.div
          key="strip"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 22, opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={`flex-none overflow-hidden border-b border-separator ${STRIP_BG[status.kind]}`}
          role="status"
          aria-live="polite"
        >
          <div className={`h-full flex items-center justify-center gap-1.5 px-3 text-[11px] ${COLORS[status.kind]}`}>
            <StatusContent status={status} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
