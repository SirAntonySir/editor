import type { Widget } from '@/types/widget';
import { useEditorStore } from '@/store';
import { nextSpawnPositionFor, pickSpawnSide, type PlacedRect, type Viewport } from '@/components/workspace/workspace-layout';
import { WIDGET_SHELL_MIN_WIDTH } from '@/components/widget/WidgetShell';
import { editorDocument } from '@/core/document';

// Workspace widget placement footprint used by the collision-aware spawn
// algorithm (nextSpawnPositionFor). Widgets spawn EXPANDED (see
// buildTetherForWidget), so this estimates a typical expanded body height — the
// real per-widget size, once React Flow has measured it, is persisted onto the
// widget node and used in preference (see the occupied-rect list below). This
// value only governs not-yet-measured widgets.
const WIDGET_SPAWN_SIZE = { w: WIDGET_SHELL_MIN_WIDTH, h: 220 } as const;


/**
 * Position `widget` next to the currently active ImageNode and create a
 * TetherEdge attaching it. Shared body between the SSE `tool_invoked` path
 * and the Suggestions ↗ engage path.
 *
 * No-op when no ImageNode can be resolved (workspace empty or no active
 * selection); caller is responsible for the workspace-mode gate.
 */
function buildTetherForWidget(widget: Widget, viewport?: Viewport): void {
  const editor = useEditorStore.getState();
  const imageNodes = editor.imageNodes;

  // Resolve target ImageNode. Widgets typically carry a layer_id on their
  // first node — locate the ImageNode containing that layer. Fall back to
  // the active image node if the layer can't be resolved.
  const firstNode = widget.nodes[0];
  const widgetLayerId = firstNode?.layerId ?? null;

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
  // Widgets spawn EXPANDED, so a placed widget's real height is hundreds of px,
  // not the collapsed-header estimate. Use the React-Flow-measured size when we
  // have it (persisted onto the widget node) so the next spawn clears the real
  // footprint instead of stacking into it. Falls back to the estimate until the
  // widget has been measured once.
  const occupied: PlacedRect[] = [
    ...Object.values(imageNodes).map((n) => ({ position: n.position, size: n.size })),
    ...Object.values(editor.widgetNodes).map((wn) => ({
      position: wn.position,
      size: wn.size ?? WIDGET_SPAWN_SIZE,
    })),
  ];

  // Pick side based on viewport. Default to LEFT when viewport unavailable.
  const targetRect: PlacedRect = { position: targetNode.position, size: targetNode.size };
  const side: 'left' | 'right' = viewport
    ? pickSpawnSide(targetRect, viewport)
    : 'left';

  const pos = nextSpawnPositionFor(
    targetRect,
    WIDGET_SPAWN_SIZE,
    'widget',
    occupied,
    side,
  );

  // SSE-driven placement: consolidate position + edge into a single history
  // snapshot so undo can roll the widget back to the pre-placement state.
  // Seed exactly ONE tether target (the widget's own layer). Multi-target
  // growth happens later via drag → update_widget_targets. Truly-global
  // widgets (no layer_id) get no rail tether — the rail connects by layer.
  editorDocument.workspace.batch('Tether widget', () => {
    editor.setWidgetPosition(widget.id, pos);
    if (widgetLayerId) {
      editor.addWidgetTarget(widget.id, targetImageNodeId, widgetLayerId);
    }
  });

  // Spawn expanded so the user can interact with the controls immediately.
  // Expansion is UI-only state, so it sits outside the undo batch above.
  editor.expandWidget(widget.id);
}

/**
 * When a new widget appears in the snapshot, position it next to the
 * currently active ImageNode and create a TetherEdge attaching it.
 *
 * Tethers tool_invoked (toolrail) and mcp_user_prompt (Cmd+K palette) widgets
 * immediately — both are explicit user actions where the user expects the
 * widget on the canvas. Autonomous AI suggestions stay in the Suggestions
 * panel and acquire a footprint only when engaged via
 * {@link tetherWorkspaceWidgetOnEngage}.
 */
export function tetherWorkspaceWidget(widget: Widget, viewport?: Viewport): void {
  const k = widget.origin.kind;
  if (k !== 'tool_invoked' && k !== 'mcp_user_prompt') return;
  buildTetherForWidget(widget, viewport);
}

/**
 * Suggestions ↗ engage side-effect. AI-origin widgets are already in the
 * snapshot from autonomous/user-prompt analyze, but they only get a canvas
 * footprint when the user explicitly engages — at which point we tether
 * them next to the active ImageNode.
 */
export function tetherWorkspaceWidgetOnEngage(widget: Widget, viewport?: Viewport): void {
  buildTetherForWidget(widget, viewport);
}
