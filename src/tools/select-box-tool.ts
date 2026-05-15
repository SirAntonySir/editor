import * as fabric from 'fabric';
import { BoxSelect } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';

let startX = 0;
let startY = 0;
let dragging = false;

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

export const SelectBoxTool: ToolDefinition = {
  name: 'select-box',
  label: 'Select Box',
  icon: BoxSelect,
  category: 'select',
  shortcut: 'X',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],

  onActivate: (ctx: ToolContext) => {
    const canvas = ctx.canvasRef.current;
    if (canvas) {
      canvas.selection = false;
      canvas.forEachObject((obj) => {
        obj.selectable = false;
        obj.evented = false;
        obj.hasControls = false;
        obj.lockMovementX = true;
        obj.lockMovementY = true;
      });
    }
    const layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch(console.error);
  },

  onPointerDown: (e: CanvasPointerEvent, ctx: ToolContext) => {
    const pt = sceneToImagePixel(e, ctx);
    if (!pt) return;
    startX = pt.x;
    startY = pt.y;
    dragging = true;
  },

  onPointerMove: (_e: CanvasPointerEvent, _ctx: ToolContext) => {
    // No live preview overlay in v1.
  },

  onPointerUp: async (e: CanvasPointerEvent, ctx: ToolContext) => {
    if (!dragging) return;
    dragging = false;
    const pt = sceneToImagePixel(e, ctx);
    if (!pt) return;
    const x1 = Math.min(startX, pt.x);
    const y1 = Math.min(startY, pt.y);
    const x2 = Math.max(startX, pt.x);
    const y2 = Math.max(startY, pt.y);
    if (x2 - x1 < 5 || y2 - y1 < 5) return;
    const layerId = useEditorStore.getState().activeLayerId;
    if (!layerId) return;
    try {
      const maskRef = await samClient.segment({
        layerId,
        prompts: [{ kind: 'box', data: [x1, y1, x2, y2] }],
      });
      useEditorStore.getState().setActiveMask(maskRef);
      useEditorStore.getState().commitMask();
    } catch (err) {
      console.error('[SelectBox] segment failed:', err);
    }
  },
};
