import { useEffect } from 'react';
import { Layers, Sparkles, X } from 'lucide-react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { createChipFromMask } from '@/lib/ai-chip-creation';

/**
 * Floating overlay shown above the canvas whenever a mask is committed.
 * Surfaces the user-driven actions for the selection — no automatic side
 * effects.
 *
 *   • Create new layer  → extractLayerFromMask
 *   • Create AI anchor  → createChipFromMask (adds a chip to the AI panel)
 *   • ×                 → discardCommittedMask (Esc shortcut)
 *
 * Hidden when nothing is committed.
 */
export function SelectionActionsOverlay() {
  const ref = useEditorStore((s) => s.committedMaskRef);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const discard = useEditorStore((s) => s.discardCommittedMask);

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

  if (!ref || !activeLayerId) return null;
  const mask = maskStore.get(ref);
  if (!mask) return null;
  const label = mask.label ?? 'Selection';

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 glass-panel px-2 py-1 text-[11px]">
      <span className="flex items-center gap-1 pr-2 mr-1 border-r border-separator text-text-secondary">
        <Sparkles size={11} className="text-accent" />
        <span className="truncate max-w-[140px]">{label}</span>
      </span>

      <button
        type="button"
        onClick={() => {
          extractLayerFromMask({ sourceLayerId: activeLayerId, maskRef: ref });
          discard();
        }}
        className="px-2 py-1 rounded inline-flex items-center gap-1
          text-text-primary hover:bg-surface-secondary transition-colors cursor-default"
      >
        <Layers size={11} className="text-text-secondary" /> Create layer
      </button>

      <button
        type="button"
        onClick={async () => {
          await createChipFromMask({ maskRef: ref, sourceLayerId: activeLayerId });
          discard();
        }}
        className="px-2 py-1 rounded inline-flex items-center gap-1
          text-text-primary hover:bg-surface-secondary transition-colors cursor-default"
      >
        <Sparkles size={11} className="text-text-secondary" /> Create AI anchor
      </button>

      <span className="mx-1 h-3 w-px bg-separator" />
      <button
        type="button"
        onClick={discard}
        title="Discard (Esc)"
        aria-label="Discard selection"
        className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors cursor-default"
      >
        <X size={11} />
      </button>
    </div>
  );
}
