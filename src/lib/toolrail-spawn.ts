// Toolrail tool click handler.
//
// Workspace canvas: the toolrail click routes through `proposeStack` with
// `forced_ops: [processingId]`, which bypasses the LLM and uses registry
// defaults (origin: tool_invoked). A widget can only be spawned when the user
// has an active ImageNode selected (T13 gate).

import { backendTools } from '@/lib/backend-tools';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { toast } from '@/components/ui/Toast';

/**
 * Handle a toolrail click for a tool with a `processingId`.
 *
 * Returns `true` when the click was handled (a `propose_widget` was kicked
 * off, the click was gated out, or there's no backend session) and `false`
 * when the tool isn't backed by a processing definition.
 */
export function spawnToolWidget(toolName: string): boolean {
  const tool = CanvasToolRegistry.get(toolName);
  if (!tool?.processingId) return false;

  // Must have an active ImageNode to know where to tether the new widget.
  const editor = useEditorStore.getState();
  const activeImageNodeId = editor.activeImageNodeId;
  if (!activeImageNodeId) {
    toast.info('Select an image first.');
    return true;
  }

  const sid = useBackendState.getState().sessionId;
  if (!sid) return true;

  // Resolve layer_id: prefer the editor's activeLayerId when it belongs to
  // the active image node, otherwise fall back to the node's first layer.
  const node = editor.imageNodes[activeImageNodeId];
  if (!node) return true;
  const layerId =
    editor.activeLayerId && node.layerIds.includes(editor.activeLayerId)
      ? editor.activeLayerId
      : node.layerIds[0];
  if (!layerId) return true;

  void backendTools.proposeStack(sid, {
    intent: tool.label ?? tool.processingId,
    scope: editor.activeScope ?? { kind: 'global' },
    forced_ops: [tool.processingId],
    layer_id: layerId,
    origin: 'tool_invoked',
  });
  return true;
}
