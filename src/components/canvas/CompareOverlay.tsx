import { useEffect, useRef, useState } from 'react';
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';

function canvasToDataURL(source: OffscreenCanvas): string {
  const tmp = document.createElement('canvas');
  tmp.width = source.width;
  tmp.height = source.height;
  const ctx = tmp.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0);
  return tmp.toDataURL();
}

export function CompareOverlay({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const compareLayout = useEditorStore((s) => s.compareLayout);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const [beforeUrl, setBeforeUrl] = useState('');
  const [afterUrl, setAfterUrl] = useState('');
  const rafRef = useRef(0);

  useEffect(() => {
    // Generate before/after images
    const update = () => {
      if (!activeLayerId) return;

      // Before: source pixels (original)
      const source = CanvasRegistry.getSource(activeLayerId);
      if (source) {
        setBeforeUrl(canvasToDataURL(source));
      }

      // After: current Fabric canvas output
      const canvas = canvasRef.current;
      if (canvas) {
        const vpt = canvas.viewportTransform;
        // Temporarily reset viewport to capture clean image
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });
        if (vpt) canvas.setViewportTransform(vpt);
        setAfterUrl(dataUrl);
      }
    };

    update();

    // Listen for store changes to update after image
    const unsub = useEditorStore.subscribe(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    });

    return () => {
      unsub();
      cancelAnimationFrame(rafRef.current);
    };
  }, [activeLayerId, canvasRef]);

  if (!beforeUrl || !afterUrl) return null;

  return (
    <div className="absolute inset-0 z-30">
      <ReactCompareSlider
        portrait={compareLayout === 'vertical'}
        itemOne={<ReactCompareSliderImage src={beforeUrl} alt="Before" style={{ objectFit: 'contain', width: '100%', height: '100%' }} />}
        itemTwo={<ReactCompareSliderImage src={afterUrl} alt="After" style={{ objectFit: 'contain', width: '100%', height: '100%' }} />}
        style={{ width: '100%', height: '100%', background: 'var(--color-canvas-bg)' }}
      />
      <div className="absolute top-2 left-2 glass-panel px-2 py-1 text-[10px] text-text-secondary pointer-events-none">
        Before
      </div>
      <div className="absolute top-2 right-2 glass-panel px-2 py-1 text-[10px] text-text-secondary pointer-events-none">
        After
      </div>
    </div>
  );
}
