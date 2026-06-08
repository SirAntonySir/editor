import { backendTools } from '@/lib/backend-tools';

/** Spawn a canvas widget for a tool (the per-section "↗ open on canvas").
 * Editing a section writes canonical directly; this is the optional promote
 * that materializes a draggable canvas shell bound to the same op. No-op when
 * offline or no active layer.
 *
 * Migrated from propose_widget to proposeStack using forced_ops. */
export function promoteToCanvas(sessionId: string | null, toolId: string, layerId: string | null): void {
  if (!sessionId || !layerId) return;
  void backendTools.proposeStack(sessionId, {
    intent: toolId,
    scope: { kind: 'global' },
    forced_ops: [toolId],
    layer_id: layerId,
    origin: 'tool_invoked',
  });
}
