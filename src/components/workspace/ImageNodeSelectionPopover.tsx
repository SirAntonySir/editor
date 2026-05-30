import { useCallback, useEffect, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Layers, X } from 'lucide-react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { extractLayerFromMask } from '@/store/segment-actions';

interface ImageNodeSelectionPopoverProps {
  /** Layers that belong to this image node — popover only opens when the
   *  committed mask belongs to one of them. */
  layerIds: string[];
  /** Trigger element rendered by Radix (usually the node header). */
  children: ReactNode;
}

/**
 * Anchors the Create-layer / Discard actions to the image node header. Only
 * mounts when there is a committed selection mask that belongs to this image
 * node. Esc discards globally.
 */
export function ImageNodeSelectionPopover({
  layerIds,
  children,
}: ImageNodeSelectionPopoverProps) {
  const ref = useEditorStore((s) => s.committedMaskRef);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const discard = useEditorStore((s) => s.discardCommittedMask);
  // Local "dismissed" flag so the user can close the popover without losing
  // the committed mask itself. Re-arms the moment a new mask is committed
  // (handled by the key on the popover root via `ref`).
  const [dismissed, setDismissed] = useState(false);
  const open = Boolean(ref) && !dismissed;
  const onOpenChange = useCallback((next: boolean) => setDismissed(!next), []);

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

  // Gate by node ownership: the popover only shows if the committed mask's
  // layer belongs to this image node. Render the trigger either way so the
  // header stays interactive for other actions.
  if (!ref || !activeLayerId) return <>{children}</>;
  const mask = maskStore.get(ref);
  if (!mask) return <>{children}</>;
  if (!layerIds.includes(mask.layerId)) return <>{children}</>;
  const label = mask.label ?? 'Selection';

  return (
    <Popover.Root key={ref} open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay z-[60] flex items-center gap-1 px-2 py-1 text-[11px]"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <span className="flex items-center gap-1 pr-2 mr-1 border-r border-separator text-text-secondary">
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
