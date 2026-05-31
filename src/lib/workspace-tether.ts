import type { Widget } from '@/types/widget';
import { useEditorStore } from '@/store';
import { nextSpawnPositionFor, type PlacedRect } from '@/components/workspace/workspace-layout';
import type { TetherEdgeState } from '@/types/workspace';
import { WIDGET_SHELL_MIN_WIDTH } from '@/components/widget/WidgetShell';
import { editorDocument } from '@/core/document';

// Workspace widget placement assumes a collapsed WidgetShell footprint.
// Width and height both vary with content, so the spawn algorithm uses the
// shell's minimum width and an estimated collapsed-header height (60).
const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH, h: 60 } as const;

/**
 * Position `widget` next to the currently active ImageNode and create a
 * TetherEdge attaching it. Shared body between the SSE `tool_invoked` path
 * and the Suggestions ↗ engage path.
 *
 * No-op when no ImageNode can be resolved (workspace empty or no active
 * selection); caller is responsible for the workspace-mode gate.
 */
function buildTetherForWidget(widget: Widget): void {
  const editor = useEditorStore.getState();
  const imageNodes = editor.imageNodes;

  // Resolve target ImageNode. Widgets typically carry a layer_id on their
  // first node — locate the ImageNode containing that layer. Fall back to
  // the active image node if the layer can't be resolved.
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
    WIDGET_SPAWN_SIZE,
    'widget',
    occupied,
  );

  // Build edge scope from the widget's WidgetNode.layer_id. Widgets without
  // a layer_id (e.g. future image_node scope) fall through to a node-wide
  // tether.
  const edgeScope: TetherEdgeState['scope'] = widgetLayerId
    ? { kind: 'layer', layerId: widgetLayerId }
    : { kind: 'node' };

  // SSE-driven placement: consolidate position + edge into a single history
  // snapshot so undo can roll the widget back to the pre-placement state.
  editorDocument.workspace.batch('Tether widget', () => {
    editor.setWidgetPosition(widget.id, pos);
    editor.setEdge({
      id: `te-${widget.id}`,
      widgetNodeId: widget.id,
      targetImageNodeId,
      scope: edgeScope,
    });
  });
}

/**
 * When a new tool-invoked widget appears in the snapshot, position it next
 * to the currently active ImageNode and create a TetherEdge attaching it.
 * No-op for AI widgets (those don't render in the canvas workspace until
 * accepted via the Suggestions ↗ engage flow — see
 * {@link tetherWorkspaceWidgetOnEngage}).
 */
export function tetherWorkspaceWidget(widget: Widget): void {
  if (widget.origin.kind !== 'tool_invoked') return;
  buildTetherForWidget(widget);
}

/**
 * Suggestions ↗ engage side-effect. AI-origin widgets are already in the
 * snapshot from autonomous/user-prompt analyze, but they only get a canvas
 * footprint when the user explicitly engages — at which point we tether
 * them next to the active ImageNode.
 */
export function tetherWorkspaceWidgetOnEngage(widget: Widget): void {
  buildTetherForWidget(widget);
}
