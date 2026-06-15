import { useEffect, useRef } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useImageNodeObjects, type ImageObject } from '@/hooks/useImageNodeObjects';
import { toast } from '@/components/ui/Toast';

interface ImageNodeObjectsLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
}

/** Sum the outline of every object into a single canvas — one paint pass
 *  for the whole image-node instead of one canvas per mask. Cell size is
 *  the canvas/mask ratio, so the stroke aligns with the underlying mask
 *  grid even when CSS scales the canvas to display size. */
function paintAllOutlines(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  objects: ImageObject[],
): void {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.beginPath();
  for (const obj of objects) {
    const { mask } = obj;
    const cellW = canvasW / mask.width;
    const cellH = canvasH / mask.height;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        const i = y * mask.width + x;
        if (mask.data[i] !== 255) continue;
        const up = y > 0 && mask.data[i - mask.width] === 255;
        const dn = y < mask.height - 1 && mask.data[i + mask.width] === 255;
        const lt = x > 0 && mask.data[i - 1] === 255;
        const rt = x < mask.width - 1 && mask.data[i + 1] === 255;
        const px = x * cellW;
        const py = y * cellH;
        if (!up) { ctx.moveTo(px, py); ctx.lineTo(px + cellW, py); }
        if (!dn) { ctx.moveTo(px, py + cellH); ctx.lineTo(px + cellW, py + cellH); }
        if (!lt) { ctx.moveTo(px, py); ctx.lineTo(px, py + cellH); }
        if (!rt) { ctx.moveTo(px + cellW, py); ctx.lineTo(px + cellW, py + cellH); }
      }
    }
  }
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';
  ctx.stroke();
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function ObjectLabel({
  obj,
  widthPx,
  heightPx,
}: { obj: ImageObject; widthPx: number; heightPx: number }) {
  const mask = obj.mask;
  const left = (obj.bbox.minX / mask.width) * widthPx;
  const top = (obj.bbox.minY / mask.height) * heightPx;

  const notYet = (action: string) =>
    toast.info(`${action} — not yet wired (backend tool pending).`);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          data-object-id={obj.id}
          // pointer-events-auto so the right-click hits this label and not
          // the React Flow node beneath it.
          className="pointer-events-auto absolute px-1.5 py-0.5 rounded-[3px] bg-surface/95 text-text-primary text-[10px] leading-none border border-separator shadow-sm cursor-default select-none"
          style={{ left: `${left}px`, top: `${Math.max(0, top - 18)}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {obj.label}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="overlay p-1 min-w-[180px] z-50">
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => notYet('Rename')}
          >
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => notYet('Convert to Layer Mask')}
          >
            Convert to Layer Mask
          </ContextMenu.Item>
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => notYet('Extract to Image Node')}
          >
            Extract to Image Node
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-separator" />
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none text-text-secondary"
            onSelect={() => notYet('Delete')}
          >
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ImageNodeObjectsLayer({
  imageNodeId,
  widthPx,
  heightPx,
}: ImageNodeObjectsLayerProps) {
  const objects = useImageNodeObjects(imageNodeId);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintAllOutlines(ctx, canvas.width, canvas.height, objects);
  }, [objects, widthPx, heightPx]);

  if (objects.length === 0) return null;

  return (
    <div
      data-testid="image-node-objects-layer"
      className="nodrag nopan pointer-events-none absolute inset-0"
      style={{ zIndex: 4 }}
    >
      <canvas
        ref={canvasRef}
        width={Math.round(widthPx)}
        height={Math.round(heightPx)}
        className="absolute inset-0 pointer-events-none"
        style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
        aria-hidden
      />
      {objects.map((obj) => (
        <ObjectLabel key={obj.id} obj={obj} widthPx={widthPx} heightPx={heightPx} />
      ))}
    </div>
  );
}
