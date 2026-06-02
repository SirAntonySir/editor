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
import type { Widget } from '@/types/widget';

const nodeTypes = { image: ImageNode, widget: WidgetNode };
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
type WorkspaceNode = ImageNodeType | WidgetNodeType;

export function CanvasWorkspace() {
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const widgetNodes = useEditorStore((s) => s.widgetNodes);
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
      const size =
        documentMeta && documentMeta.width > 0 && documentMeta.height > 0
          ? { w: documentMeta.width, h: documentMeta.height }
          : undefined;
      addImageNode(
        layers.map((l) => l.id),
        { x: 100, y: 100 },
        size,
      );
    }
  }, [imageNodes, layers, documentMeta, addImageNode]);

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
    return [...imgs, ...widgets];
  }, [imageNodes, widgetNodes, snapshotWidgets]);

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
    for (const w of snapshotWidgets) {
      if (w.status !== 'active') continue;
      const widgetNode = widgetNodes[w.id];
      if (!widgetNode) continue; // no canvas footprint without a tether
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
      // Route each edge to the image's nearest edge (see pickTetherHandles).
      // Re-picks on drag-stop (widgetNodes updates) and on any image-node move.
      const target = imageNodes[targetId];
      // Widget header height ≈ 28px → approximate centre y at +14 from the node origin.
      const widgetCenter = {
        x: widgetNode.position.x + WIDGET_SHELL_MIN_WIDTH / 2,
        y: widgetNode.position.y + 14,
      };
      const imageBounds = {
        x0: target.position.x,
        y0: target.position.y,
        x1: target.position.x + target.size.w,
        y1: target.position.y + target.size.h,
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
    return out;
  }, [snapshotWidgets, imageNodes, widgetNodes, activeImageNodeId]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      // Drag-stop fires once per drag (not per frame), so a single history
      // entry per drag is what we want.
      if (node.type === 'image') editorDocument.workspace.setNodePosition(node.id, node.position);
      else if (node.type === 'widget') editorDocument.workspace.setWidgetPosition(node.id, node.position);
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
