import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { scopeFromSelection } from '@/lib/scope-from-selection';
import { getAiAccess } from '@/lib/ai-access';

/** Spawn a canvas widget for a tool (the per-section Pin / ↗ open on canvas).
 * Editing a section writes canonical directly; this is the optional promote
 * that materializes a draggable canvas shell bound to the same op. No-op when
 * offline or no active layer.
 *
 * The pin targets the ACTIVE layer only: we send `layerIds: [layerId]` rather
 * than every layer of the node. The `layerIds` array is the backend's
 * broadcast-across-the-node trigger (see scope.ts / propose-stack.ts) — sending
 * the whole stack made pinned adjustments spread across the node and land on
 * the base layer instead of the selected one.
 *
 * Migrated from propose_widget to proposeStack using forced_ops. */
export function promoteToCanvas(sessionId: string | null, toolId: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  // Study baseline gates OFF the AI parametric widget layer — the frontend
  // never opts itself into spawning a canvas widget (see ai-access.ts).
  if (!getAiAccess()) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  void backendTools.proposeStack(sessionId, {
    intent: toolId,
    scope,
    forced_ops: [toolId],
    layerId,
    layerIds: [layerId],
    origin: 'tool_invoked',
  });
}

/** Pin a single parameter of a tool to the canvas as a one-control widget.
 *  Queues a pin filter for the upcoming `${layerId}:${opAdjustmentType}`
 *  widget, then spawns the op via the same proposeStack path. The
 *  widget.created handler in backend-state-slice drains the queue and writes
 *  `pinnedWidgetParams[widgetId] = [paramKey]`, which the WidgetShell uses
 *  to render only that one binding row. */
export function promoteSingleParamToCanvas(
  sessionId: string | null,
  toolId: string,
  opAdjustmentType: string,
  layerId: string | null,
  paramKey: string,
): void {
  if (!sessionId || !layerId) return;
  if (!getAiAccess()) return;
  useEditorStore.getState().queuePinRequest(layerId, opAdjustmentType, [paramKey]);
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  void backendTools.proposeStack(sessionId, {
    intent: `${toolId}:${paramKey}`,
    scope,
    forced_ops: [toolId],
    layerId,
    // Target the active layer only — see promoteToCanvas for why we don't
    // broadcast across the whole node here.
    layerIds: [layerId],
    origin: 'tool_invoked',
  });
}
