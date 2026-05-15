import * as fabric from 'fabric';
import { MousePointerClick } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';

/**
 * Convert a scene-space point (from canvas.getScenePoint) into image-pixel
 * coordinates relative to the first FabricImage on the canvas.
 *
 * Fabric places images at their center by default (originX/Y = 'center'),
 * so the image top-left in scene space is:
 *   imgLeft = img.left  - (img.width  * scaleX) / 2
 *   imgTop  = img.top   - (img.height * scaleY) / 2
 */
function sceneToImagePixel(
  sceneX: number,
  sceneY: number,
  img: fabric.FabricImage,
): { x: number; y: number } {
  const scaleX = img.scaleX ?? 1;
  const scaleY = img.scaleY ?? 1;
  const imgLeft = img.left - (img.width * scaleX) / 2;
  const imgTop = img.top - (img.height * scaleY) / 2;
  return {
    x: (sceneX - imgLeft) / scaleX,
    y: (sceneY - imgTop) / scaleY,
  };
}

export const SelectPointTool: ToolDefinition = {
  name: 'select-point',
  label: 'Select Point',
  icon: MousePointerClick,
  category: 'select',
  modes: ['develop', 'compose'],
  shortcut: 'P',
  cursor: 'crosshair',

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

  onPointerDown: async (e: CanvasPointerEvent, ctx: ToolContext) => {
    const layerId = useEditorStore.getState().activeLayerId;
    if (!layerId) return;

    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const img = canvas
      .getObjects()
      .find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) {
      console.warn('[SelectPoint] no FabricImage on canvas');
      return;
    }

    const { x: imageX, y: imageY } = sceneToImagePixel(e.x, e.y, img);

    try {
      const maskRef = await samClient.segment({
        layerId,
        prompts: [{ kind: 'point', data: [imageX, imageY, 1] }],
      });
      useEditorStore.getState().setActiveMask(maskRef);
      useEditorStore.getState().commitMask();
    } catch (err) {
      console.error('[SelectPoint] segment failed:', err);
    }
  },
};
