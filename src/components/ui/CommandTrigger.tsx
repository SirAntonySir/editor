import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useBackendState } from '@/store/backend-state-slice';
import { usePaletteRuntime } from '@/store/palette-runtime';

/** Trim a prompt for the pill label so a long sentence doesn't blow out the bar. */
function truncate(text: string, max = 34): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Floating command bar at the bottom-center of the canvas. Styled like a search
 *  input; clicking it (or pressing ⌘K) opens the command palette. Disabled when
 *  the backend is not connected.
 *
 *  Shares a Framer `layoutId` with the palette shell so opening the palette
 *  morphs this bar up to the center of the screen and expands it into the
 *  full panel. We unmount while the palette is open so only one element
 *  carries the shared id at any time. */
export function CommandTrigger() {
  const sseStatus = useBackendState((s) => s.sseStatus);
  const disabled = sseStatus !== 'open';
  const [paletteOpen, setPaletteOpen] = useState(false);
  // An Agent turn submitted from the palette keeps running after the palette
  // closes; the pill carries its loading (and failure) state so the user can
  // watch the proposed widgets/segmentation questions appear on the canvas.
  const pending = usePaletteRuntime((s) => s.pending);
  const error = usePaletteRuntime((s) => s.error);

  useEffect(() => {
    const onOpen = () => setPaletteOpen(true);
    const onClose = () => setPaletteOpen(false);
    window.addEventListener('palette:opened', onOpen);
    window.addEventListener('palette:closed', onClose);
    return () => {
      window.removeEventListener('palette:opened', onOpen);
      window.removeEventListener('palette:closed', onClose);
    };
  }, []);

  return (
    <AnimatePresence>
      {!paletteOpen && (
        <motion.button
          layoutId="command-palette-shell"
          type="button"
          aria-label="Open command palette"
          title="Open command palette (⌘K)"
          disabled={disabled}
          onClick={() => window.dispatchEvent(new CustomEvent('spawn-palette:open'))}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
          style={{
            background: 'color-mix(in srgb, var(--color-surface) 88%, transparent)',
          }}
          className={`overlay pointer-events-auto flex items-center gap-2.5 h-9
            min-w-[300px] pl-3 pr-2 text-xs backdrop-blur-md
            transition-colors duration-150
            ${pending ? ' ai-shimmer' : ''}
            ${disabled
              ? 'opacity-40 cursor-not-allowed text-text-secondary'
              : 'text-text-secondary hover:text-text-primary cursor-text'}`}
        >
          {pending ? (
            <>
              <Loader2 size={15} className="shrink-0 text-[var(--color-ai)] animate-spin" />
              <span className="flex-1 text-left truncate text-text-primary">
                Working… <span className="text-text-secondary">{truncate(pending)}</span>
              </span>
            </>
          ) : error ? (
            <>
              <AlertCircle size={15} className="shrink-0 text-[var(--color-danger,#e5484d)]" />
              <span className="flex-1 text-left truncate text-text-primary">
                That didn’t go through — <span className="text-text-secondary">click to retry</span>
              </span>
              <Kbd keys={['mod', 'K']} />
            </>
          ) : (
            <>
              <Plus size={15} className="shrink-0" />
              <span className="flex-1 text-left">Search Atelier…</span>
              <Kbd keys={['mod', 'K']} />
            </>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
