import { useEffect, useState } from 'react';
import { Sparkles, Loader2, CircleX } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAiSession } from '@/hooks/useImageContext';

const READY_DISMISS_MS = 3000;

export function AnalyseIndicator() {
  const status = useAiSession((s) => s.status);
  const error = useAiSession((s) => s.error);
  const [readyDismissed, setReadyDismissed] = useState(false);

  // Auto-dismiss the "ready" pill after a few seconds; reset on any status change.
  useEffect(() => {
    if (status !== 'ready') {
      setReadyDismissed(false);
      return;
    }
    const handle = setTimeout(() => setReadyDismissed(true), READY_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [status]);

  const visible = status !== 'idle' && !(status === 'ready' && readyDismissed);

  const icon = (() => {
    if (status === 'uploading' || status === 'analysing') return <Loader2 className="h-3 w-3 animate-spin" />;
    if (status === 'ready') return <Sparkles className="h-3 w-3" />;
    return <CircleX className="h-3 w-3" />;
  })();

  const label = (() => {
    if (status === 'uploading') return 'Uploading image…';
    if (status === 'analysing') return 'Analysing image…';
    if (status === 'ready') return 'Image context ready';
    return error ?? 'Analysis failed';
  })();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-6 left-6 z-40 glass-panel px-2 py-1 flex items-center gap-1 text-[11px] text-text-secondary"
        >
          {icon}
          <span>{label}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
