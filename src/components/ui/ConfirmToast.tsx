import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

export interface ConfirmRequest {
  id: number;
  text: string;
  allowLabel: string;
  denyLabel: string;
  onAllow: () => void;
  onDeny: () => void;
}

let counter = 0;
const listeners = new Set<(req: ConfirmRequest | null) => void>();

/** Subscribe to confirm-toast requests. Returns an unsubscribe function. */
export function onConfirm(fn: (req: ConfirmRequest | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Module-level confirm-toast emitter. Unlike the plain `toast` (which is text
 * only and auto-dismisses), a confirm request persists until the user clicks
 * Allow or Deny, then resolves via the matching callback. Replace-latest
 * semantics: a new ask supersedes any prior pending request — the prior one's
 * callbacks are dropped silently. Callers wanting to "cancel" can invoke
 * `dismiss()` directly.
 */
export const confirmToast = {
  ask(opts: {
    text: string;
    onAllow: () => void;
    onDeny: () => void;
    allowLabel?: string;
    denyLabel?: string;
  }): void {
    const req: ConfirmRequest = {
      id: ++counter,
      text: opts.text,
      allowLabel: opts.allowLabel ?? 'Allow',
      denyLabel: opts.denyLabel ?? 'Deny',
      onAllow: opts.onAllow,
      onDeny: opts.onDeny,
    };
    listeners.forEach((l) => l(req));
  },
  dismiss(): void {
    listeners.forEach((l) => l(null));
  },
};

/**
 * Renders the current confirm request (or nothing) as a slim banner under the
 * status bar. Allow / Deny buttons fire the request's callbacks and dismiss
 * the banner. One mount per app.
 */
export function ConfirmToastBar() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => onConfirm(setReq), []);

  function handleAllow() {
    req?.onAllow();
    setReq(null);
  }
  function handleDeny() {
    req?.onDeny();
    setReq(null);
  }

  return (
    <AnimatePresence initial={false}>
      {req && (
        <motion.div
          key={req.id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="flex-none overflow-hidden border-b border-separator bg-ai/10"
          role="dialog"
          aria-live="polite"
        >
          <div className="h-7 flex items-center gap-3 px-3 text-[11px]">
            <Sparkles size={13} className="text-ai shrink-0" aria-hidden />
            <span className="flex-1 truncate text-text-primary">{req.text}</span>
            <button
              type="button"
              onClick={handleDeny}
              className="px-2.5 py-0.5 rounded-[var(--radius-button)] text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
            >
              {req.denyLabel}
            </button>
            <button
              type="button"
              onClick={handleAllow}
              className="px-2.5 py-0.5 rounded-[var(--radius-button)] text-white bg-ai hover:brightness-110"
            >
              {req.allowLabel}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
