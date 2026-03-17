import { Paintbrush } from 'lucide-react';
import type { ToolDefinition, CanvasPointerEvent, ToolContext } from '@/types/tool';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useEditorStore } from '@/store';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { editorDocument } from '@/core/document';
import { useState } from 'react';

// Module-level state (not in React — shared with pointer handlers)
let currentBrushLayerId: string | null = null;
let isDrawing = false;
let points: { x: number; y: number; pressure: number }[] = [];

const brushConfig = { size: 10, opacity: 1, hardness: 0.8, color: '#000000' };

function getBaseImageSize(): { width: number; height: number } | null {
  const { layers } = useEditorStore.getState();
  for (const layer of layers) {
    if (layer.type !== 'image') continue;
    const working = CanvasRegistry.get(layer.id);
    if (working && working.width > 0) return { width: working.width, height: working.height };
  }
  return null;
}

function getPixelCoords(e: CanvasPointerEvent, ctx: ToolContext): { x: number; y: number } | null {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return null;
  const obj = canvas.getObjects()[0];
  if (!obj) return null;

  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  const w = obj.width ?? 0;
  const h = obj.height ?? 0;

  // Fabric.js v7 uses center origin — adjust to top-left pixel coords
  return {
    x: (e.x - left) / scaleX + w / 2,
    y: (e.y - top) / scaleY + h / 2,
  };
}

function drawStrokeSegment(
  offscreen: OffscreenCanvas,
  pts: { x: number; y: number; pressure: number }[],
  size: number,
  opacity: number,
  color: string,
  hardness: number,
): void {
  const ctx = offscreen.getContext('2d');
  if (!ctx || pts.length < 2) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const prevP = pts[i - 1];
    ctx.lineWidth = size * (0.5 + 0.5 * p.pressure);

    if (hardness < 1) {
      ctx.shadowBlur = (1 - hardness) * ctx.lineWidth;
      ctx.shadowColor = color;
    }

    if (i >= 2) {
      const p0 = pts[i - 2];
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

function ensureBrushLayer(): string | null {
  if (currentBrushLayerId && CanvasRegistry.has(currentBrushLayerId)) {
    return currentBrushLayerId;
  }

  const size = getBaseImageSize();
  if (!size) return null;

  const id = crypto.randomUUID();
  const offscreen = new OffscreenCanvas(size.width, size.height);

  // Register with a transparent source
  CanvasRegistry.register(id, offscreen);

  const store = useEditorStore.getState();
  const brushCount = store.layers.filter((l) => l.type === 'brush').length;
  store.addLayer({
    id,
    type: 'brush',
    name: `Brush ${brushCount + 1}`,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });

  currentBrushLayerId = id;
  return id;
}

function BrushPanel() {
  const [size, setSize] = useState(10);
  const [opacity, setOpacity] = useState(100);
  const [hardness, setHardness] = useState(80);
  const [color, setColor] = useState('#000000');

  brushConfig.size = size;
  brushConfig.opacity = opacity / 100;
  brushConfig.hardness = hardness / 100;
  brushConfig.color = color;

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
    currentBrushLayerId = null;
  },

  onDeactivate: async (ctx) => {
    // Commit any in-progress transaction on tool switch
    if (isDrawing) {
      isDrawing = false;
      points = [];
      await editorDocument.commitTransaction();
    }
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;
    canvas.selection = true;
    canvas.forEachObject((obj) => {
      obj.selectable = true;
      obj.evented = true;
    });
    currentBrushLayerId = null;
  },

  onPointerDown: async (e, ctx) => {
    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    const layerId = ensureBrushLayer();
    if (!layerId) return;

    await editorDocument.beginTransaction('Brush Stroke', [layerId]);

    isDrawing = true;
    points = [{ x: pt.x, y: pt.y, pressure: e.rawEvent.pressure || 0.5 }];
  },

  onPointerMove: (e, ctx) => {
    if (!isDrawing || !currentBrushLayerId) return;
    const pt = getPixelCoords(e, ctx);
    if (!pt) return;

    points.push({ x: pt.x, y: pt.y, pressure: e.rawEvent.pressure || 0.5 });

    const offscreen = CanvasRegistry.get(currentBrushLayerId);
    if (!offscreen) return;

    if (points.length >= 2) {
      drawStrokeSegment(offscreen, points.slice(-3), brushConfig.size, brushConfig.opacity, brushConfig.color, brushConfig.hardness);
      useEditorStore.getState().bumpPixelVersion();
    }
  },

  onPointerUp: async () => {
    if (isDrawing) {
      isDrawing = false;
      points = [];
      useEditorStore.getState().bumpPixelVersion();
      await editorDocument.commitTransaction();
    }
  },
};
