import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Sparkles, Layers, Wand2, Lock, X } from 'lucide-react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { openPaletteWith } from '@/lib/palette-bus';

/**
 * Contextual "Selection" section — appears at the top of the Inspector tab
 * when a mask has been committed. Replaces the previous floating
 * SegmentActionsBar.
 */
export function SegmentActionsSection() {
  const ref = useEditorStore((s) => s.committedMaskRef);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const discard = useEditorStore((s) => s.discardCommittedMask);
  const setActiveScope = useEditorStore((s) => s.setActiveScope);

  // Escape to discard.
  useEffect(() => {
    if (!ref) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        discard();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref, discard]);

  const visible = !!(ref && activeLayerId);
  const mask = ref ? maskStore.get(ref) : null;
  const label = mask?.label ?? 'Selection';

  return (
    <Tooltip.Provider delayDuration={300}>
      <AnimatePresence initial={false}>
        {visible && ref && activeLayerId && (
          <motion.section
            key="selection"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="border-b border-separator overflow-hidden"
          >
            <header className="flex items-center justify-between px-3 py-2 border-b border-separator">
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Sparkles size={11} className="text-accent" />
                <span className="truncate">{label}</span>
              </div>
              <button
                type="button"
                onClick={discard}
                title="Discard (Esc)"
                aria-label="Discard selection"
                className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors cursor-default"
              >
                <X size={12} />
              </button>
            </header>

            <ActionRow
              icon={Layers}
              label="Extract layer"
              description="Copy the selected region into a new layer above this one."
              onClick={() => {
                extractLayerFromMask({ sourceLayerId: activeLayerId, maskRef: ref });
                discard();
              }}
            />
            <ActionRow
              icon={Wand2}
              label="Edit with AI"
              description="Send this region to the AI composer as the edit target."
              onClick={() => {
                openPaletteWith({ kind: 'mask', layerId: activeLayerId, maskRef: ref }, 'append');
              }}
            />
            <ActionRow
              icon={Lock}
              label="Mask next adjustment"
              description="The next adjustment you add (Curves, Levels, Light…) will only apply to this region."
              onClick={() => {
                setActiveScope({ kind: 'mask', maskRef: ref });
                discard();
              }}
            />
          </motion.section>
        )}
      </AnimatePresence>
    </Tooltip.Provider>
  );
}

function ActionRow({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof Layers;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-primary
            hover:bg-surface-secondary transition-colors cursor-default text-left"
        >
          <Icon size={12} className="text-text-secondary shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="left"
          align="center"
          sideOffset={8}
          className="glass-panel z-[60] max-w-[240px] px-2 py-1 text-[11px] text-text-secondary shadow-lg leading-snug"
        >
          {description}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
