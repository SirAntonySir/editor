import { Paintbrush } from 'lucide-react';
import type { ToolDefinition, CanvasPointerEvent, ToolContext } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { PixelHistoryManager } from '@/lib/pixel-history';
import { useState } from 'react';

interface BrushState {
  isDrawing: boolean;
  points: { x: number; y: number; pressure: number }[];
  snapshotId: string | null;
}

const brushState: BrushState = {
  isDrawing: false,
  points: [],
  snapshotId: null,
};

function drawStroke(
  offscreen: OffscreenCanvas,
  points: { x: number; y: number; pressure: number }[],
  size: number,
  opacity: number,
  color: string,
  hardness: number,
): void {
  const ctx = offscreen.getContext('2d');
  if (!ctx || points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prevP = points[i - 1];
    const lineWidth = size * (0.5 + 0.5 * p.pressure);

    ctx.lineWidth = lineWidth;

    if (hardness < 1) {
      ctx.shadowBlur = (1 - hardness) * lineWidth;
      ctx.shadowColor = color;
    }

    // Catmull-Rom smoothing
    if (i >= 2) {
      const p0 = points[i - 2];
      const cpx = prevP.x + (p.x - p0.x) / 6;
      const cpy = prevP.y + (p.y - p0.y) / 6;
      ctx.quadraticCurveTo(cpx, cpy, (prevP.x + p.x) / 2, (prevP.y + p.y) / 2);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  ctx.stroke();
  ctx.restore();
}

function getPixelCoords(e: CanvasPointerEvent, ctx: ToolContext): { x: number; y: number } | null {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return null;
  const obj = canvas.getObjects()[0];
  if (!obj) return null;

  // Convert canvas scene coords to image pixel coords
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;

  return {
    x: (e.x - left) / scaleX,
    y: (e.y - top) / scaleY,
  };
}

function BrushPanel() {
  const [size, setSize] = useState(10);
  const [opacity, setOpacity] = useState(100);
  const [hardness, setHardness] = useState(80);
  const [color, setColor] = useState('#000000');

  // Store in a global ref for the pointer handlers
  (window as unknown as Record<string, unknown>).__brushConfig = { size, opacity: opacity / 100, hardness: hardness / 100, color };

  return (
    <div className="p-3 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="w-8 h-8 rounded border border-separator cursor-pointer"
        />
      </div>
      <AdjustmentSlider label="Size" value={size} min={1} max={200} onChange={setSize} formatValue={(v) => `${v}px`} />
      <AdjustmentSlider label="Opacity" value={opacity} min={1} max={100} onChange={setOpacity} formatValue={(v) => `${v}%`} />
      <AdjustmentSlider label="Hardness" value={hardness} min={0} max={100} onChange={setHardness} formatValue={(v) => `${v}%`} />
    </div>
  );
}

function getBrushConfig(): { size: number; opacity: number; hardness: number; color: string } {
  return (window as unknown as Record<string, unknown>).__brushConfig as { size: number; opacity: number; hardness: number; color: string } ?? { size: 10, opacity: 1, hardness: 0.8, color: '#000000' };
}

export const BrushTool: ToolDefinition = {
  name: 'brush',
  label: 'Brush',
  icon: Paintbrush,
  category: 'draw',
  shortcut: 'P',
  cursor: 'crosshair',
  OptionsPanel: BrushPanel,

  onActivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = false;
    canvas.forEachObject((obj) => {
      obj.selectable = false;
      obj.evented = false;
    });
  },

  onDeactivate: (ctx) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
    });
  },

  onPointerDown: async (e, ctx) => {
    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return;

    // Capture snapshot before drawing
    const snapshotId = await PixelHistoryManager.captureFullCanvas(activeLayerId, offscreen);

    brushState.isDrawing = true;
    brushState.snapshotId = snapshotId;
    brushState.points = [{ x: pt.x, y: pt.y, pressure: e.rawEvent.pressure || 0.5 }];
  },

  onPointerMove: (e, ctx) => {
    if (!brushState.isDrawing) return;
    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    brushState.points.push({ x: pt.x, y: pt.y, pressure: e.rawEvent.pressure || 0.5 });

    // Draw incrementally
    const { activeLayerId } = useEditorStore.getState();
    if (!activeLayerId) return;
    const offscreen = CanvasRegistry.get(activeLayerId);
    if (!offscreen) return;

    const config = getBrushConfig();
    const points = brushState.points;
    if (points.length >= 2) {
      const last2 = points.slice(-2);
      drawStroke(offscreen, last2, config.size, config.opacity, config.color, config.hardness);

      // Update fabric canvas
      const canvas = ctx.canvasRef.current;
      if (canvas) {
        const fabricImg = canvas.getObjects()[0];
        if (fabricImg) {
          const tmp = document.createElement('canvas');
          tmp.width = offscreen.width;
          tmp.height = offscreen.height;
          const tmpCtx = tmp.getContext('2d');
          if (tmpCtx) {
            tmpCtx.drawImage(offscreen, 0, 0);
            (fabricImg as import('fabric').FabricImage).setElement(tmp);
            canvas.requestRenderAll();
          }
        }
      }
    }
  },

  onPointerUp: () => {
    brushState.isDrawing = false;
    brushState.points = [];
    brushState.snapshotId = null;
  },
};
