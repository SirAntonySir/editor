import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ToastMessage {
  id: number;
  text: string;
  variant: 'info' | 'error';
}

let counter = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

/**
 * Module-level toast emitter. Call from anywhere; the rendered ToastHost
 * (mounted once at the app root) subscribes and displays. Queue is replace-
 * latest (length 1) — the newest message wins.
 */
export const toast = {
  info(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'info' };
    listeners.forEach((l) => l(msg));
  },
  error(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'error' };
    listeners.forEach((l) => l(msg));
  },
};

/**
 * Mount once at the app root.
 * Renders one absolutely-positioned toast at the bottom-centre of the viewport.
 */
export function ToastHost(): React.ReactElement {
  const [msg, setMsg] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const fn = (m: ToastMessage) => setMsg(m);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (!msg) return;
    const handle = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(handle);
  }, [msg]);

  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 glass-panel px-3 py-2 text-[11px] ${
            msg.variant === 'error' ? 'text-red-300' : 'text-text-primary'
          }`}
          role="status"
        >
          {msg.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
