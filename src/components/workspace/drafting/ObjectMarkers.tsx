import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { useImageNodeObjects, type ImageObject } from '@/hooks/useImageNodeObjects';
import { renameObject } from '@/lib/segmentation/object-actions';

interface ObjectMarkersProps {
  imageNodeId: string;
  /** Image body display width — anchors the gutter column. */
  widthPx: number;
  /** Image body display height — clamps the input's vertical position. */
  heightPx: number;
  /** Pixel width of the right-margin gutter. */
  marginWidth: number;
}

const INPUT_X_OFFSET = 18; // distance from image right edge to the input
const INPUT_HEIGHT = 22;

/**
 * Transient inline-rename surface in the right gutter.
 *
 * The persistent numbered markers (dots + leader lines + name text) were
 * removed with the hover-only mask work (2026-07-08): objects have no
 * standing visual presence — masks paint on hover and the name lives in the
 * cursor tooltip (SegmentHitLayer). What remains here is the one affordance
 * that needs a mounted text input: context-menu Rename stamps
 * `pendingObjectRenameId`, this surface mounts an input beside the object's
 * vertical position, and commits/cancels collapse it back to nothing.
 */
export function ObjectMarkers({ imageNodeId, widthPx, heightPx, marginWidth }: ObjectMarkersProps) {
  const objects = useImageNodeObjects(imageNodeId);
  const pendingRenameId = useEditorStore((s) => s.pendingObjectRenameId);
  const renaming = pendingRenameId
    ? objects.find((o) => o.id === pendingRenameId) ?? null
    : null;

  if (!renaming) return null;
  return (
    <div
      className="absolute pointer-events-none"
      style={{ top: 0, left: 0, width: `${widthPx}px`, height: `${heightPx}px`, zIndex: 7 }}
    >
      <div
        className="absolute pointer-events-auto"
        style={{
          left: `${widthPx + INPUT_X_OFFSET}px`,
          top: `${renameInputTop(renaming, heightPx)}px`,
          width: `${Math.max(0, marginWidth - INPUT_X_OFFSET)}px`,
        }}
      >
        <RenameInput obj={renaming} />
      </div>
    </div>
  );
}

/** Vertical anchor: the object's bbox-centre y in display px, clamped so the
 *  input stays inside the image body. */
function renameInputTop(obj: ImageObject, heightPx: number): number {
  const cyNorm = (obj.bbox.minY + obj.bbox.maxY) / 2 / obj.mask.height;
  return Math.max(0, Math.min(heightPx - INPUT_HEIGHT, cyNorm * heightPx - INPUT_HEIGHT / 2));
}

function RenameInput({ obj }: { obj: ImageObject }) {
  const clearRenameRequest = useEditorStore((s) => s.clearObjectRenameRequest);
  const [draft, setDraft] = useState(obj.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  function finish(): void {
    if (draft.trim() && draft.trim() !== obj.label) {
      maskStore.setLabel(obj.id, draft.trim());
      void renameObject(obj.id, draft.trim());
    }
    clearRenameRequest(obj.id);
  }
  function cancel(): void {
    clearRenameRequest(obj.id);
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      onClick={(e) => e.stopPropagation()}
      className="nodrag nopan bg-transparent text-text-primary font-[var(--font-display,Fraunces)] italic text-[14px] leading-none outline-none w-[10ch] border-b border-[var(--color-accent)]"
      aria-label={`Rename object ${obj.label}`}
    />
  );
}
