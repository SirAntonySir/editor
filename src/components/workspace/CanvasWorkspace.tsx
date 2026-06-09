import { useEffect, useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { ImageNode, type ImageNodeData } from './ImageNode';
import { WidgetNode, type WidgetNodeData } from './WidgetNode';
import { TetherEdge, type TetherEdgeType } from './TetherEdge';
import { pickTetherHandles } from './tether-handles';
import { WIDGET_SHELL_MIN_WIDTH } from '@/components/widget/WidgetShell';
import { InfoNode, type InfoNodeData } from './InfoNode';
import type { Widget } from '@/types/widget';

const nodeTypes = { image: ImageNode, widget: WidgetNode, info: InfoNode };
const edgeTypes = { tether: TetherEdge };

/**
 * Listens for Delete/Backspace and removes selected image and widget nodes.
 * Edges are auto-derived from active widgets (see CanvasWorkspace) and
 * therefore not user-deletable. Rendered as a child of `<ReactFlow>` so
 * `useReactFlow` returns *this* flow's instance.
 */
function WorkspaceKeyHandler() {
  const { getNodes, getZoom, zoomTo, zoomIn, zoomOut, fitView } = useReactFlow();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const selectedNodes = getNodes().filter((n) => n.selected);
      if (selectedNodes.length === 0) return;

      const sessionId = useBackendState.getState().sessionId;

      for (const node of selectedNodes) {
        if (node.type === 'image') {
          editorDocument.workspace.removeImageNode(node.id);
        } else if (node.type === 'info') {
          // Frontend-only info widgets — remove straight off the store
          // (recorded into history for undo).
          editorDocument.workspace.removeInfoNode(node.id);
        } else if (node.type === 'widget') {
          if (sessionId) {
            // Backend will SSE the deletion back to us. Undoing a backend
            // widget deletion needs backend cooperation and is deferred.
            void backendTools.delete_widget(sessionId, { widget_id: node.id, suppress_similar: false });
          }
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getNodes]);

  // Viewport controls dispatched from MenuBar via `useCanvasZoom`.
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent<{ zoom: number }>).detail;
      if (detail) zoomTo(detail.zoom);
    };
    const onFit = () => fitView();
    const onIn = () => zoomIn();
    const onOut = () => zoomOut();
    // Keep the editor-store zoom roughly in sync for the status bar.
    const onPaneScroll = () => useEditorStore.getState().setZoom(getZoom());

    window.addEventListener('workspace:zoom', onZoom);
    window.addEventListener('workspace:fit-view', onFit);
    window.addEventListener('workspace:zoom-in', onIn);
    window.addEventListener('workspace:zoom-out', onOut);
    window.addEventListener('wheel', onPaneScroll, { passive: true });
    return () => {
      window.removeEventListener('workspace:zoom', onZoom);
      window.removeEventListener('workspace:fit-view', onFit);
      window.removeEventListener('workspace:zoom-in', onIn);
      window.removeEventListener('workspace:zoom-out', onOut);
      window.removeEventListener('wheel', onPaneScroll);
    };
  }, [getZoom, zoomTo, zoomIn, zoomOut, fitView]);

  return null;
}

const EMPTY_WIDGETS: Widget[] = [];

type ImageNodeType = Node<ImageNodeData, 'image'>;
type WidgetNodeType = Node<WidgetNodeData, 'widget'>;
type InfoNodeType  = Node<InfoNodeData, 'info'>;
type WorkspaceNode = ImageNodeType | WidgetNodeType | InfoNodeType;

export function CanvasWorkspace() {
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const widgetNodes = useEditorStore((s) => s.widgetNodes);
  const infoNodes = useEditorStore((s) => s.infoNodes);
  const layers = useEditorStore((s) => s.layers);
  const documentMeta = useEditorStore((s) => s.documentMeta);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const addImageNode = useEditorStore((s) => s.addImageNode);

  // Auto-create an ImageNode for the current document's layers on first mount
  // when no nodes exist yet. Ensures the workspace shows the open image immediately.
  useEffect(() => {
    if (Object.keys(imageNodes).length === 0 && layers.length > 0) {
      const sourceSize =
        documentMeta && documentMeta.width > 0 && documentMeta.height > 0
          ? { w: documentMeta.width, h: documentMeta.height }
          : undefined;
      addImageNode(
        layers.map((l) => l.id),
        { x: 100, y: 100 },
        sourceSize,
      );
    }
  }, [imageNodes, layers, documentMeta, addImageNode]);

  // Whenever there's at least one image node but none is active, promote the
  // first to active. This fires for ALL paths an image can arrive through —
  // freshly auto-created, restored from a saved session, opened via Cmd+O —
  // not just the auto-create case. The Info tab's live mechanical hook, the
  // sidebar's Auto buttons, and Cmd+K all gate on `activeImageNodeId`, so a
  // missing active id is what was leaving the Auto pill perma-disabled.
  useEffect(() => {
    if (activeImageNodeId) return;
    const ids = Object.keys(imageNodes);
    if (ids.length > 0) setActiveImageNode(ids[0]);
  }, [imageNodes, activeImageNodeId, setActiveImageNode]);

  const storeNodes = useMemo<WorkspaceNode[]>(() => {
    const imgs: ImageNodeType[] = Object.values(imageNodes).map((n) => ({
      id: n.id,
      type: 'image',
      position: n.position,
      // Only the header strip drags the node; the canvas body and footer ignore drag.
      dragHandle: '.workspace-drag-handle',
      data: {
        layerIds: n.layerIds,
        size: n.size,
        sourceSize: n.sourceSize,
        name: n.layerIds[0] ?? 'Image',
      },
    }));
    // Render only widgets that have been tethered. Untethered widgets (e.g.
    // unengaged AI suggestions or Cmd+K palette widgets) live in the
    // Suggestions panel until the user engages them; rendering them at the
    // default (0, 0) would also break edge geometry.
    const widgets: WidgetNodeType[] = snapshotWidgets
      .filter((w) => w.status === 'active' && widgetNodes[w.id])
      .map((w) => ({
        id: w.id,
        type: 'widget',
        position: widgetNodes[w.id].position,
        // Only the header drags; sliders and other body controls work freely.
        dragHandle: '.workspace-drag-handle',
        data: { widget: w },
      }));
    // Frontend-only info widgets — same drag-handle pattern as image / widget
    // nodes so the header strip drags while the body's clipboard / Ask AI
    // buttons stay clickable.
    const infos: InfoNodeType[] = Object.values(infoNodes).map((n) => ({
      id: n.id,
      type: 'info',
      position: n.position,
      dragHandle: '.workspace-drag-handle',
      data: { infoNodeId: n.id },
    }));
    return [...imgs, ...widgets, ...infos];
  }, [imageNodes, widgetNodes, snapshotWidgets, infoNodes]);

  // Local RF state mirrors the store. React Flow needs to own positions during
  // drag (via onNodesChange) so the visual position follows the cursor without
  // snap-back on re-renders. Drag-stop persists back to the store.
  const [nodes, setNodes] = useState<WorkspaceNode[]>(storeNodes);
  useEffect(() => {
    setNodes(storeNodes);
  }, [storeNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev) as WorkspaceNode[]);
  }, []);

  // Edges are auto-derived from active widgets. Each widget gets one edge to
  // the image node it belongs to: image_node-scoped widgets target their
  // `scope.image_node_id`; otherwise we resolve via `nodes[0].layer_id` and
  // fall back to the active image node.
  const edges = useMemo<TetherEdgeType[]>(() => {
    const out: TetherEdgeType[] = [];

    // Build a quick lookup of React Flow's current node positions + measured dims.
    // Using the local `nodes` state (vs the Zustand store) keeps the picker
    // in sync with React Flow's rendered positions, especially right after a drag.
    // Info nodes now participate too — each gets a tether edge back to the
    // image it belongs to, same handle-picker as widgets.
    const rfLookup = new Map<string, { position: { x: number; y: number }; size: { w: number; h: number } }>();
    for (const n of nodes) {
      let w: number;
      let h: number;
      if (n.type === 'widget') {
        w = n.measured?.width  ?? WIDGET_SHELL_MIN_WIDTH;
        h = n.measured?.height ?? 80; // ~collapsed widget; will be replaced once measured
      } else if (n.type === 'info') {
        // Info nodes' size grows with content; prefer measured, fall back
        // to a sensible default that won't blow up the geometry math.
        w = n.measured?.width  ?? 280;
        h = n.measured?.height ?? 80;
      } else {
        w = n.measured?.width  ?? (n.data as ImageNodeData).size.w;
        h = n.measured?.height ?? (n.data as ImageNodeData).size.h;
      }
      rfLookup.set(n.id, { position: n.position, size: { w, h } });
    }

    for (const w of snapshotWidgets) {
      if (w.status !== 'active') continue;
      const widgetNode = widgetNodes[w.id];
      if (!widgetNode) continue; // no canvas footprint without a tether
      const rfWidget = rfLookup.get(w.id);
      if (!rfWidget) continue;

      let targetId: string | null = null;
      let scopeKind: 'layer' | 'node' = 'layer';
      if (w.scope.kind === 'image_node') {
        if (imageNodes[w.scope.image_node_id]) {
          targetId = w.scope.image_node_id;
          scopeKind = 'node';
        }
      }
      if (!targetId) {
        const layerId = w.nodes[0]?.layer_id;
        if (layerId) {
          for (const n of Object.values(imageNodes)) {
            if (n.layerIds.includes(layerId)) { targetId = n.id; break; }
          }
        }
      }
      if (!targetId && activeImageNodeId && imageNodes[activeImageNodeId]) {
        targetId = activeImageNodeId;
      }
      if (!targetId) continue;

      const rfTarget = rfLookup.get(targetId);
      if (!rfTarget) continue;

      // Route each edge to the image's nearest edge (see pickTetherHandles).
      // Re-picks whenever local `nodes` state changes (drag, resize, mount).
      // Use the widget's full bounding box centre, not a header-band approximation —
      // otherwise the picker treats a widget that is visually below the image as if
      // it were inside the image's vertical band (because the header centre is
      // still inside the image bbox) and routes to a left/right handle instead of
      // top/bottom.
      const widgetCenter = {
        x: rfWidget.position.x + rfWidget.size.w / 2,
        y: rfWidget.position.y + rfWidget.size.h / 2,
      };
      const imageBounds = {
        x0: rfTarget.position.x,
        y0: rfTarget.position.y,
        x1: rfTarget.position.x + rfTarget.size.w,
        y1: rfTarget.position.y + rfTarget.size.h,
      };
      const { sourceHandle, targetHandle } = pickTetherHandles(widgetCenter, imageBounds);
      out.push({
        id: `auto-${w.id}`,
        source: w.id,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: 'tether',
        data: { scopeKind },
        selectable: false,
      });
    }

    // ─── Info-node tethers ─────────────────────────────────────────
    // Each info widget that records a `targetImageNodeId` gets a tether to
    // that image. Reuses the same `pickTetherHandles` routing as widgets so
    // the visual rhythm of the canvas stays consistent.
    for (const info of Object.values(infoNodes)) {
      const targetId = info.targetImageNodeId;
      if (!targetId || !imageNodes[targetId]) continue;
      const rfInfo = rfLookup.get(info.id);
      const rfTarget = rfLookup.get(targetId);
      if (!rfInfo || !rfTarget) continue;

      const infoCenter = {
        x: rfInfo.position.x + rfInfo.size.w / 2,
        y: rfInfo.position.y + rfInfo.size.h / 2,
      };
      const imageBounds = {
        x0: rfTarget.position.x,
        y0: rfTarget.position.y,
        x1: rfTarget.position.x + rfTarget.size.w,
        y1: rfTarget.position.y + rfTarget.size.h,
      };
      const { sourceHandle, targetHandle } = pickTetherHandles(infoCenter, imageBounds);
      out.push({
        id: `auto-info-${info.id}`,
        source: info.id,
        target: targetId,
        sourceHandle,
        targetHandle,
        type: 'tether',
        data: { scopeKind: 'node' },
        selectable: false,
      });
    }
    return out;
  }, [snapshotWidgets, imageNodes, widgetNodes, infoNodes, activeImageNodeId, nodes]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      // Drag-stop fires once per drag (not per frame), so a single history
      // entry per drag is what we want.
      if (node.type === 'image') editorDocument.workspace.setNodePosition(node.id, node.position);
      else if (node.type === 'widget') editorDocument.workspace.setWidgetPosition(node.id, node.position);
      else if (node.type === 'info')   editorDocument.workspace.setInfoNodePosition(node.id, node.position);
    },
    [],
  );

  // Workspace tracks "the currently active image node" derived from React Flow's
  // selection event. If exactly one image node is selected, mirror it; otherwise clear.
  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[]; edges: Edge[] }) => {
      const imageSel = nodes.filter((n) => n.type === 'image');
      setActiveImageNode(imageSel.length === 1 ? imageSel[0].id : null);
    },
    [setActiveImageNode],
  );

  const onConnect = useCallback((_: Connection) => {
    // Manual edge dragging is disabled in v1; ignore.
  }, []);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        minZoom={0.05}
        maxZoom={4}
        fitView
      >
        <Background color="var(--color-separator)" gap={16} size={1} />
        <Controls showInteractive={false} />
        <WorkspaceKeyHandler />
      </ReactFlow>
    </div>
  );
}
