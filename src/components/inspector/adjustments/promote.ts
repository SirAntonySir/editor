import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { scopeFromSelection } from '@/lib/scope-from-selection';

function activeNodeLayerIds(): string[] | undefined {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) return undefined;
  return editor.imageNodes[id]?.layerIds;
}

/** Spawn a canvas widget for a tool (the per-section Pin / ↗ open on canvas).
 * Editing a section writes canonical directly; this is the optional promote
 * that materializes a draggable canvas shell bound to the same op. No-op when
 * offline or no active layer.
 *
 * Migrated from propose_widget to proposeStack using forced_ops. */
export function promoteToCanvas(sessionId: string | null, toolId: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: toolId,
    scope,
    forced_ops: [toolId],
    layerId,
    ...(layerIds ? { layerIds } : {}),
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
  useEditorStore.getState().queuePinRequest(layerId, opAdjustmentType, [paramKey]);
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: `${toolId}:${paramKey}`,
    scope,
    forced_ops: [toolId],
    layerId,
    ...(layerIds ? { layerIds } : {}),
    origin: 'tool_invoked',
  });
}
