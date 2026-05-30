import type { Widget } from '@/types/widget';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { nextSpawnPositionFor, type PlacedRect } from '@/components/workspace/workspace-layout';
import type { TetherEdgeState } from '@/types/workspace';
import { WIDGET_SHELL_WIDTH } from '@/components/widget/WidgetShell';

// Workspace widget placement assumes a collapsed WidgetShell footprint.
// Height varies, but the spawn algorithm only needs an estimate to detect
// overlaps; 60 is a reasonable collapsed-header height.
const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_WIDTH, h: 60 } as const;

/**
 * Workspace-mode side-effect: when a new tool-invoked widget appears in the
 * snapshot, position it next to the currently active ImageNode and create a
 * TetherEdge attaching it. No-op on the Fabric branch, and no-op for AI
 * widgets (those don't render in the canvas workspace until accepted).
 */
export function tetherWorkspaceWidget(widget: Widget): void {
  if (!usePreferencesStore.getState().useWorkspaceCanvas) return;
  if (widget.origin.kind !== 'tool_invoked') return;

  const editor = useEditorStore.getState();
  const imageNodes = editor.imageNodes;

  // Resolve target ImageNode. tool_invoked widgets always carry a layer_id on
  // their first node — locate the ImageNode containing that layer. Fall back
  // to the active image node if the layer can't be resolved.
  const firstNode = widget.nodes[0];
  const widgetLayerId = firstNode?.layer_id ?? null;

  let targetImageNodeId: string | null = null;
  if (widgetLayerId) {
    for (const n of Object.values(imageNodes)) {
      if (n.layerIds.includes(widgetLayerId)) {
        targetImageNodeId = n.id;
        break;
      }
    }
  }
  if (!targetImageNodeId) targetImageNodeId = editor.activeImageNodeId;
  if (!targetImageNodeId) return;

  const targetNode = imageNodes[targetImageNodeId];
  if (!targetNode) return;

  // Build the occupied-rect list: every image node + every positioned widget.
  const occupied: PlacedRect[] = [
    ...Object.values(imageNodes).map((n) => ({ position: n.position, size: n.size })),
    ...Object.values(editor.widgetNodes).map((wn) => ({
      position: wn.position,
      size: WIDGET_SPAWN_SIZE,
    })),
  ];

  const pos = nextSpawnPositionFor(
    { position: targetNode.position, size: targetNode.size },
    'widget',
    occupied,
  );

  // Build edge scope from the widget's WidgetNode.layer_id. AI widgets that
  // somehow reach this branch (e.g. future image_node scope) fall through to
  // a node-wide tether.
  const edgeScope: TetherEdgeState['scope'] = widgetLayerId
    ? { kind: 'layer', layerId: widgetLayerId }
    : { kind: 'node' };

  editor.setWidgetPosition(widget.id, pos);
  editor.setEdge({
    id: `te-${widget.id}`,
    widgetNodeId: widget.id,
    targetImageNodeId,
    scope: edgeScope,
  });
}
