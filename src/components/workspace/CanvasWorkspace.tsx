import { useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  type Node,
  type Edge,
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
import type { Widget } from '@/types/widget';

const nodeTypes = { image: ImageNode, widget: WidgetNode };
const edgeTypes = { tether: TetherEdge };

/**
 * Listens for Delete/Backspace and removes selected image nodes, widget nodes,
 * and tether edges. Rendered as a child of `<ReactFlow>` so `useReactFlow`
 * returns *this* flow's instance.
 */
function WorkspaceKeyHandler() {
  const { getNodes, getEdges } = useReactFlow();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      const selectedNodes = getNodes().filter((n) => n.selected);
      const selectedEdges = getEdges().filter((edge) => edge.selected);

      if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

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
      for (const edge of selectedEdges) {
        editorDocument.workspace.unbindEdge(edge.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [getNodes, getEdges]);

  return null;
}

const EMPTY_WIDGETS: Widget[] = [];

type ImageNodeType = Node<ImageNodeData, 'image'>;
type WidgetNodeType = Node<WidgetNodeData, 'widget'>;
type WorkspaceNode = ImageNodeType | WidgetNodeType;

export function CanvasWorkspace() {
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const widgetNodes = useEditorStore((s) => s.widgetNodes);
  const tetherEdges = useEditorStore((s) => s.tetherEdges);
  const layers = useEditorStore((s) => s.layers);
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const addImageNode = useEditorStore((s) => s.addImageNode);

  // Auto-create an ImageNode for the current document's layers on first mount
  // when no nodes exist yet. Ensures the workspace shows the open image immediately.
  useEffect(() => {
    if (Object.keys(imageNodes).length === 0 && layers.length > 0) {
      addImageNode(
        layers.map((l) => l.id),
        { x: 100, y: 100 },
      );
    }
  }, [imageNodes, layers, addImageNode]);

  const nodes = useMemo<WorkspaceNode[]>(() => {
    const imgs: ImageNodeType[] = Object.values(imageNodes).map((n) => ({
      id: n.id,
      type: 'image',
      position: n.position,
      data: {
        layerIds: n.layerIds,
        size: n.size,
        name: n.layerIds[0] ?? 'Image',
      },
    }));
    const widgets: WidgetNodeType[] = snapshotWidgets
      .filter((w) => w.status === 'active')
      .map((w) => ({
        id: w.id,
        type: 'widget',
        position: widgetNodes[w.id]?.position ?? { x: 0, y: 0 },
        data: { widget: w },
      }));
    return [...imgs, ...widgets];
  }, [imageNodes, widgetNodes, snapshotWidgets]);

  const edges = useMemo<TetherEdgeType[]>(
    () =>
      Object.values(tetherEdges).map((e) => ({
        id: e.id,
        source: e.widgetNodeId,
        target: e.targetImageNodeId,
        type: 'tether',
        data: { scopeKind: e.scope.kind },
      })),
    [tetherEdges],
  );

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
        onNodeDragStop={onNodeDragStop}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background color="var(--color-separator)" gap={16} size={1} />
        <Controls showInteractive={false} />
        <WorkspaceKeyHandler />
      </ReactFlow>
    </div>
  );
}
