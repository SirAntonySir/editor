import { useEffect } from 'react';
import { Layers, Wand2, Lock, X } from 'lucide-react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from '@/store/segment-actions';
import { openPaletteWith } from '@/lib/palette-bus';

export function SegmentActionsBar() {
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

  if (!ref || !activeLayerId) return null;
  const mask = maskStore.get(ref);
  if (!mask) return null;
  const label = mask.label ?? 'Selection';

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 glass-panel px-3 py-2 text-xs">
      <span className="text-text-secondary">✨ {label}</span>
      <span className="opacity-30">|</span>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          extractLayerFromMask({ sourceLayerId: activeLayerId, maskRef: ref });
          discard();
        }}
      >
        <Layers className="w-3 h-3" /> Extract layer
      </button>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          openPaletteWith({ kind: 'mask', layerId: activeLayerId, maskRef: ref }, 'append');
        }}
      >
        <Wand2 className="w-3 h-3" /> Edit with AI
      </button>

      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1"
        onClick={() => {
          setActiveScope({ kind: 'mask', maskRef: ref });
          discard();
        }}
      >
        <Lock className="w-3 h-3" /> Scope adjustment
      </button>

      <span className="opacity-30">|</span>
      <button
        type="button"
        className="px-2 py-1 hover:bg-surface-secondary rounded inline-flex items-center gap-1 opacity-70"
        onClick={discard}
        title="Discard (Esc)"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
