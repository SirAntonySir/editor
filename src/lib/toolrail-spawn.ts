// Toolrail tool click handler.
//
// Two branches:
//  • Fabric canvas (default): keep the existing cursor-bind flow — set
//    `pendingBind` and let `CanvasWidgetLayer.onCanvasDrop` commit on click.
//  • Workspace canvas: there's no canvas drop site, so the toolrail click
//    is a direct `propose_widget` call. A widget can only be spawned when
//    the user has an active ImageNode selected (T13 gate).

import { backendTools } from '@/lib/backend-tools';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { toast } from '@/components/ui/Toast';

/**
 * Handle a toolrail click for a tool with a `processingId`.
 *
 * Returns `true` when the click was handled by the workspace branch (i.e.
 * a `propose_widget` was kicked off or the click was gated out) and `false`
 * when the caller should fall through to the legacy cursor-bind flow.
 */
export function spawnToolWidget(toolName: string): boolean {
  const tool = CanvasToolRegistry.get(toolName);
  if (!tool?.processingId) return false;

  const useWorkspace = usePreferencesStore.getState().useWorkspaceCanvas;
  if (!useWorkspace) {
    // Fabric branch: legacy cursor-bind flow.
    useEditorStore.getState().startToolBind(toolName);
    return true;
  }

  // Workspace branch: must have an active ImageNode to know where to
  // tether the new widget.
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

  void backendTools.propose_widget(sid, {
    intent: tool.label ?? tool.processingId,
    scope: editor.activeScope ?? { kind: 'global' },
    fused_tool_id: tool.processingId,
    layer_id: layerId,
    origin: 'tool_invoked',
  });
  return true;
}
