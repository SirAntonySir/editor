import { startTransition, useEffect, useState } from 'react';
import { maskStore } from '@/core/mask-store';
import { useEditorStore } from '@/store';
import type { MaskSummary } from '@/types/widget';

interface Props {
  layerId: string;
  mask: MaskSummary;
}

/**
 * Nested row under an image layer. Shows a small mask preview, the segment
 * label, and selects the corresponding scope on click (same effect as
 * canvas-clicking the segment).
 */
export function SegmentRow({ layerId, mask }: Props) {
  const activeScope = useEditorStore((s) => s.activeScope);
  const isSelected = activeScope?.kind === 'mask' && activeScope.mask_id === mask.id;
  const [thumb, setThumb] = useState<string>('');

  useEffect(() => {
    const m = maskStore.get(mask.id);
    if (!m) return;
    const tmp = document.createElement('canvas');
    tmp.width = 12; tmp.height = 12;
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(12, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const mx = Math.floor((x / 12) * m.width);
        const my = Math.floor((y / 12) * m.height);
        const set = m.data[my * m.width + mx] ? 255 : 40;
        const i = (y * 12 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 159;
        img.data[i + 2] = 10;
        img.data[i + 3] = set;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Defer the state update — this effect runs synchronously; startTransition
    // avoids the set-state-in-effect cascading-render warning.
    startTransition(() => setThumb(tmp.toDataURL()));
  }, [mask.id]);

  function onSelect() {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: mask.id });
    useEditorStore.getState().setActiveLayer(layerId);
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'grid items-center text-left w-full text-[10px] py-1 pl-5 pr-2 border-l-2 transition-colors ' +
        (isSelected
          ? 'bg-amber-500/15 border-amber-500 text-text-primary'
          : 'border-separator hover:bg-surface-secondary text-text-secondary')
      }
      style={{ gridTemplateColumns: '14px 1fr 14px', gap: 6 }}
    >
      {thumb
        ? <img src={thumb} alt="" className="w-3 h-3 rounded-sm" />
        : <span className="w-3 h-3 rounded-sm bg-surface-secondary" />}
      <span className="truncate">{mask.label ?? mask.id.slice(0, 6)}</span>
      <span className="text-text-secondary text-[9px]">●</span>
    </button>
  );
}
