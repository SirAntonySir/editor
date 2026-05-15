import * as fabric from 'fabric';
import { MousePointer } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';
import type { SamPrompt } from '@/core/mask-store';

// ---------------------------------------------------------------------------
// Module-scoped state — cleared on activate / deactivate.
// ---------------------------------------------------------------------------
let prompts: SamPrompt[] = [];
let layerId: string | null = null;
let enterListener: ((e: KeyboardEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a scene-space point (from canvas.getScenePoint) into image-pixel
 * coordinates relative to the first FabricImage on the canvas.
 * Mirrors the conversion in select-point-tool.ts.
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

/** Re-run segmentation with the accumulated prompts. */
async function rerunSegmentation(): Promise<void> {
  if (!layerId) return;
  try {
    const maskRef = await samClient.segment({ layerId, prompts: [...prompts] });
    useEditorStore.getState().setActiveMask(maskRef);
  } catch (err) {
    console.error('[SelectMultiPoint] segment failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const SelectMultiPointTool: ToolDefinition = {
  name: 'select-multi-point',
  label: 'Select Multi-Point',
  icon: MousePointer,
  category: 'select',
  shortcut: 'M',
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
    prompts = [];
    layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch(console.error);

    // Wire Enter → commit the accumulated mask and reset prompts.
    enterListener = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        useEditorStore.getState().commitMask();
        prompts = [];
      }
    };
    window.addEventListener('keydown', enterListener);
  },

  onDeactivate: () => {
    if (enterListener) {
      window.removeEventListener('keydown', enterListener);
      enterListener = null;
    }
    prompts = [];
    layerId = null;
  },

  onPointerDown: async (e: CanvasPointerEvent, ctx: ToolContext) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const img = canvas
      .getObjects()
      .find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) {
      console.warn('[SelectMultiPoint] no FabricImage on canvas');
      return;
    }

    const { x: imageX, y: imageY } = sceneToImagePixel(e.x, e.y, img);

    // Alt-click → negative point (label 0); regular click → positive (label 1).
    const isNegative =
      !!(e as unknown as { altKey?: boolean }).altKey ||
      !!((e as unknown as { original?: { altKey?: boolean } }).original?.altKey);
    const label = isNegative ? 0 : 1;

    prompts.push({ kind: 'point', data: [imageX, imageY, label] });
    await rerunSegmentation();
  },
};
