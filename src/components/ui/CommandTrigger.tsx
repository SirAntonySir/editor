import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useBackendState } from '@/store/backend-state-slice';

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
            ${disabled
              ? 'opacity-40 cursor-not-allowed text-text-secondary'
              : 'text-text-secondary hover:text-text-primary cursor-text'}`}
        >
          <Plus size={15} className="shrink-0" />
          <span className="flex-1 text-left">Search tools or ask AI…</span>
          <Kbd keys={['mod', 'K']} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
