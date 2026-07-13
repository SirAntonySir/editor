import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { getPresetThumb } from '@/lib/preset-thumbs';

/**
 * 48×36 preview of the active layer's ORIGINAL pixels with one preset
 * applied. Bitmaps come from the module-level cache in `preset-thumbs`
 * (rendered lazily the first time the category is expanded). Shows a
 * placeholder while pending, when no layer is active, or when the pipeline
 * pass fails — same undrawn idiom as `EditTargetPreview`.
 */
export function PresetThumb({ presetId, layerId }: { presetId: string; layerId: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!layerId) return;
    let cancelled = false;
    void getPresetThumb(presetId, layerId).then((bmp) => {
      if (cancelled || !bmp) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      setDrawn(true);
    });
    return () => {
      cancelled = true;
    };
  }, [presetId, layerId]);

  return (
    <span
      className="relative w-12 h-9 flex-none flex items-center justify-center rounded-[3px]
        bg-surface-secondary overflow-hidden
        ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)]"
    >
      <canvas
        ref={canvasRef}
        width={1}
        height={1}
        className={`w-full h-full object-cover ${drawn ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden
      />
      {!drawn && (
        <ImageIcon
          size={12}
          data-testid="preset-thumb-placeholder"
          className="absolute text-text-secondary opacity-50"
          aria-hidden
        />
      )}
    </span>
  );
}
