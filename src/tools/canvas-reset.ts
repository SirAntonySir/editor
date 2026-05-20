import type { ToolContext } from '@/types/tool';

/**
 * Reset Fabric.js canvas to a sane interactive state.
 *
 * Objects are selectable and receive events (for inspector hover, etc.)
 * but movement is locked so nothing is accidentally dragged while
 * the user is adjusting sliders or using non-move tools.
 *
 * Space-bar + drag panning is handled at the canvas level and always works.
 */
export function resetCanvasInteraction(ctx: ToolContext): void {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return;
  canvas.selection = true;
  canvas.forEachObject((obj) => {
    obj.selectable = true;
    obj.evented = true;
    obj.hasControls = false;
    obj.lockMovementX = true;
    obj.lockMovementY = true;
  });
}
