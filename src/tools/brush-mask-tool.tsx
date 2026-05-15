import { useState } from 'react';
import * as fabric from 'fabric';
import { Paintbrush } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';

const brushConfig = { size: 30, mode: 'add' as 'add' | 'subtract' };

function sceneToImagePixel(e: CanvasPointerEvent, ctx: ToolContext): { x: number; y: number } | null {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return null;
  const img = canvas.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
  if (!img) return null;
  const sx = img.scaleX ?? 1;
  const sy = img.scaleY ?? 1;
  const imgLeft = (img.left ?? 0) - (img.width * sx) / 2;
  const imgTop = (img.top ?? 0) - (img.height * sy) / 2;
  return {
    x: (e.x - imgLeft) / sx,
    y: (e.y - imgTop) / sy,
  };
}

function paintAt(maskRef: string, x: number, y: number) {
  const mask = maskStore.get(maskRef);
  if (!mask) return;
  const data = new Uint8Array(mask.data);
  const r = brushConfig.size / 2;
  const value = brushConfig.mode === 'add' ? 255 : 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const ix = Math.round(x + dx);
      const iy = Math.round(y + dy);
      if (ix < 0 || iy < 0 || ix >= mask.width || iy >= mask.height) continue;
      data[iy * mask.width + ix] = value;
    }
  }
  maskStore.updateData(maskRef, data);
  useEditorStore.getState().bumpPixelVersion();
}

function BrushMaskOptionsPanel() {
  const [size, setSize] = useState(brushConfig.size);
  const [mode, setMode] = useState(brushConfig.mode);
  return (
    <div className="p-3 flex flex-col gap-3">
      <label className="flex items-center justify-between text-xs">
        Size
        <input type="range" min={2} max={200} value={size}
               onChange={(e) => { setSize(+e.target.value); brushConfig.size = +e.target.value; }} />
      </label>
      <label className="flex items-center justify-between text-xs">
        Mode
        <select value={mode}
                onChange={(e) => { const m = e.target.value as 'add'|'subtract'; setMode(m); brushConfig.mode = m; }}>
          <option value="add">Add</option>
          <option value="subtract">Subtract</option>
        </select>
      </label>
    </div>
  );
}

export const BrushMaskTool: ToolDefinition = {
  name: 'brush-mask',
  label: 'Mask Brush',
  icon: Paintbrush,
  category: 'select',
  shortcut: 'K',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],
  OptionsPanel: BrushMaskOptionsPanel,

  onPointerDown: (e: CanvasPointerEvent, ctx: ToolContext) => {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return;
    const pt = sceneToImagePixel(e, ctx);
    if (!pt) return;
    paintAt(ref, pt.x, pt.y);
  },

  onPointerMove: (e: CanvasPointerEvent, ctx: ToolContext) => {
    // Only paint while a button is held. CanvasPointerEvent may expose this.
    const buttons = (e as unknown as { buttons?: number }).buttons
      ?? ((e as unknown as { original?: { buttons?: number } }).original?.buttons ?? 0);
    if (!buttons) return;
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return;
    const pt = sceneToImagePixel(e, ctx);
    if (!pt) return;
    paintAt(ref, pt.x, pt.y);
  },
};
