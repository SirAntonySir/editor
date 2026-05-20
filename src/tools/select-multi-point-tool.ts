import * as fabric from 'fabric';
import { Crosshair } from 'lucide-react';
import type { ToolDefinition, ToolContext, CanvasPointerEvent } from '@/types/tool';
import { useEditorStore } from '@/store';
import { samClient } from '@/lib/sam/sam-client';
import { toast } from '@/components/ui/Toast';
import { maskStore } from '@/core/mask-store';
import { maskUnion, maskSubtract } from '@/lib/mask-overlap';
import type { MaskRef } from '@/types/scope';

// ---------------------------------------------------------------------------
// Module-scoped state — cleared on activate / deactivate.
// ---------------------------------------------------------------------------
//
// The multi-point tool composes a selection by OR-merging one SAM mask per
// click. This is different from passing all clicks to SAM at once: SAM with
// multiple positive points tries to find ONE mask containing them all (which
// loses you the second object when the clicks are on different things). By
// running SAM independently per click and merging the results, the user can
// build up a union of distinct objects — and Alt-click subtracts.
//
// Each click also commits immediately, so the SelectionActionsOverlay is
// available the moment the user has anything selected — no Enter required.
// Esc (handled by the overlay) discards and resets the accumulation.
let accumulatedMaskRef: MaskRef | null = null;
let layerId: string | null = null;
let discardListener: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const SelectMultiPointTool: ToolDefinition = {
  name: 'select-multi-point',
  label: 'Select Multi-Point',
  icon: Crosshair,
  category: 'select',
  shortcut: 'M',
  cursor: 'crosshair',
  modes: ['develop', 'compose'],
  requiresAiContext: true,

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
    accumulatedMaskRef = null;
    layerId = useEditorStore.getState().activeLayerId;
    if (layerId) void samClient.ensureEmbedding(layerId).catch((err) => {
      console.error('[SelectMultiPoint] embed failed:', err);
      toast.error('Segment encoder unavailable — is the backend running?');
    });

    // The SelectionActionsOverlay clears `committedMaskRef` when the user
    // dismisses or completes an action — when that happens we drop our
    // accumulation so the next click starts a fresh selection.
    discardListener = useEditorStore.subscribe((state, prev) => {
      if (prev.committedMaskRef && !state.committedMaskRef) {
        accumulatedMaskRef = null;
      }
    });
  },

  onDeactivate: () => {
    if (discardListener) {
      discardListener();
      discardListener = null;
    }
    accumulatedMaskRef = null;
    layerId = null;
  },

  onPointerDown: async (e: CanvasPointerEvent, ctx: ToolContext) => {
    const canvas = ctx.canvasRef.current;
    if (!canvas || !layerId) return;

    const img = canvas
      .getObjects()
      .find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
    if (!img) {
      console.warn('[SelectMultiPoint] no FabricImage on canvas');
      return;
    }

    const { x: imageX, y: imageY } = sceneToImagePixel(e.x, e.y, img);
    const isNegative =
      !!(e as unknown as { altKey?: boolean }).altKey ||
      !!((e as unknown as { original?: { altKey?: boolean } }).original?.altKey);

    try {
      // Run SAM with JUST this click — get a per-object mask, not a
      // multi-prompt "find one thing containing all clicks" mask.
      const clickMaskRef = await samClient.segment({
        layerId,
        prompts: [{ kind: 'point', data: [imageX, imageY, 1] }],
      });
      const clickMask = maskStore.get(clickMaskRef);
      if (!clickMask) return;

      if (accumulatedMaskRef === null) {
        // First click. Positive → use as starting mask. Negative on empty
        // accumulation does nothing.
        if (!isNegative) {
          accumulatedMaskRef = clickMaskRef;
        }
      } else {
        const current = maskStore.get(accumulatedMaskRef);
        if (!current) {
          accumulatedMaskRef = isNegative ? null : clickMaskRef;
        } else {
          const merged = isNegative
            ? maskSubtract(current, clickMask)
            : maskUnion(current, clickMask);
          accumulatedMaskRef = maskStore.register({
            layerId,
            width: merged.width,
            height: merged.height,
            data: merged.data,
            source: 'sam-points',
            createdAt: Date.now(),
            label: current.label,
          });
        }
      }

      // Commit immediately so the SelectionActionsOverlay surfaces the
      // current accumulation. The user can keep clicking to grow the
      // selection (each click OR-merges); when satisfied, they trigger
      // "Create layer" or "Create AI anchor" on the overlay.
      useEditorStore.getState().setActiveMask(accumulatedMaskRef);
      useEditorStore.getState().commitMask();
    } catch (err) {
      console.error('[SelectMultiPoint] segment failed:', err);
      toast.error(err instanceof Error ? err.message : 'Segmentation failed.');
    }
  },
};
