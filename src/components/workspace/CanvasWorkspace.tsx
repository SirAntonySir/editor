import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { ImageNode, type ImageNodeData } from './ImageNode';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import type { NodeProps } from '@xyflow/react';
import { WidgetNode, type WidgetNodeData } from './WidgetNode';
import { TetherEdge, type TetherEdgeType } from './TetherEdge';
import { pickTetherHandles } from './tether-handles';
import { WIDGET_SHELL_MIN_WIDTH } from '@/components/widget/WidgetShell';
import { InfoNode, type InfoNodeData } from './InfoNode';
import type { Widget } from '@/types/widget';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { rejoinSourceImage } from '@/lib/image-node-actions';
import { rejoinTargetId, nodeHasUnappliedChanges } from '@/lib/workspace-drag';
import { toast } from '@/components/ui/Toast';

/** Per-node ErrorBoundary so a render throw in one ImageNode doesn't
 *  unmount the whole React Flow canvas (and with it every sibling node).
 *  Defined here rather than inside ImageNode itself because a function
 *  component cannot catch its own render throws — the boundary has to be
 *  a parent. */
function ImageNodeWithBoundary(props: NodeProps) {
  return (
    <ErrorBoundary label={`image-node:${props.id}`}>
      <ImageNode {...(props as unknown as Parameters<typeof ImageNode>[0])} />
    </ErrorBoundary>
  );
}

const nodeTypes = { image: ImageNodeWithBoundary, widget: WidgetNode, info: InfoNode };
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
            void backendTools.delete_widget(sessionId, { widgetId: node.id, suppressSimilar: false });
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

/** Auto-fit the viewport whenever the IMAGE-node set changes — initial mount,
 *  reload, or a freshly loaded/added image — once ReactFlow has measured the
 *  new nodes.
 *
 *  Keyed ONLY off the image-node ids, so loading an image re-fits but a widget
 *  or info node appearing does NOT yank the user's pan/zoom. The fit waits for
 *  `useNodesInitialized()` (true once every mounted node has gone through the
 *  internal ResizeObserver) so the fit math reads real bboxes, not the
 *  zero-width boxes of an unmounted node — i.e. it runs *after* the image has
 *  mounted. A bare rAF-after-count was racy for exactly that reason. */
function WorkspaceAutoFit() {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const imageNodeKey = useEditorStore((s) => Object.keys(s.imageNodes).sort().join(','));
  const prevKey = useRef<string | null>(null);
  const pendingFit = useRef(false);

  useEffect(() => {
    // A change in the image-node set (load / reload / add / remove) schedules a
    // fit — but only when image nodes exist (don't fit an emptied canvas).
    if (imageNodeKey !== prevKey.current) {
      prevKey.current = imageNodeKey;
      if (imageNodeKey !== '') pendingFit.current = true;
    }
    if (!pendingFit.current || !nodesInitialized) return;
    // Defer one frame past the initialised signal so any in-flight layout
    // adjustments (image-node header height, widget shell expansion) have
    // landed in ReactFlow's internal store before the fit math reads node
    // bboxes. fitView is async-safe; we don't await it.
    const handle = requestAnimationFrame(() => {
      fitView({ padding: 0.18, duration: 0 });
      pendingFit.current = false;
    });
    return () => cancelAnimationFrame(handle);
  }, [imageNodeKey, nodesInitialized, fitView]);

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
  // first to active. This fires ONCE on the first arrival of image-nodes —
  // freshly auto-created, restored from a saved session, opened via Cmd+O.
  // It does NOT re-promote on subsequent renders, so an explicit deselect
  // (clicking blank canvas) sticks and the right sidebar can unmount.
  const hasAutoPromoted = useRef(false);
  useEffect(() => {
    if (hasAutoPromoted.current) return;
    if (activeImageNodeId) { hasAutoPromoted.current = true; return; }
    const ids = Object.keys(imageNodes);
    if (ids.length > 0) {
      setActiveImageNode(ids[0]);
      hasAutoPromoted.current = true;
    }
  }, [imageNodes, activeImageNodeId, setActiveImageNode]);

  const storeNodes = useMemo<WorkspaceNode[]>(() => {
    const imgs: ImageNodeType[] = Object.values(imageNodes).map((n) => {
      // Header title: prefer the first layer's human-readable name (set to
      // file.name by openImage / addImage). Falls back to the layer id only
      // if the layer record is missing — which shouldn't happen in practice
      // but keeps the header populated for resurrected sessions before the
      // layer-slice rehydrates.
      const firstLayer = n.layerIds[0] ? layers.find((l) => l.id === n.layerIds[0]) : undefined;
      return {
        id: n.id,
        type: 'image',
        position: n.position,
        // Only the header strip drags the node; the canvas body and footer ignore drag.
        dragHandle: '.workspace-drag-handle',
        data: {
          layerIds: n.layerIds,
          size: n.size,
          sourceSize: n.sourceSize,
          name: n.name ?? firstLayer?.name ?? n.layerIds[0] ?? 'Image',
        },
      };
    });
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
  }, [imageNodes, widgetNodes, snapshotWidgets, infoNodes, layers]);

  // Local RF state mirrors the store. React Flow needs to own positions during
  // drag (via onNodesChange) so the visual position follows the cursor without
  // snap-back on re-renders. Drag-stop persists back to the store.
  const [nodes, setNodes] = useState<WorkspaceNode[]>(storeNodes);
  useEffect(() => {
    setNodes(storeNodes);
  }, [storeNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev) as WorkspaceNode[]);
    // Persist React-Flow-measured widget sizes so spawn-placement collision
    // (workspace-tether) avoids each widget's REAL expanded footprint instead
    // of a fixed header estimate. Dimension changes are event-driven (RF emits
    // them on measure/resize), so this doesn't run on every render.
    const wn = useEditorStore.getState().widgetNodes;
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue;
      const node = wn[c.id];
      if (!node) continue; // only positioned widget nodes carry a footprint
      const w = c.dimensions.width;
      const h = c.dimensions.height;
      if (!node.size || Math.abs(node.size.w - w) > 1 || Math.abs(node.size.h - h) > 1) {
        useEditorStore.getState().setWidgetSize(c.id, { w, h });
      }
    }
  }, []);

  // Edges are auto-derived from active widgets. Each widget gets one edge to
  // the image node it belongs to: resolve via the first node's layerId and
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
      const layerId = w.nodes[0]?.layerId;
      if (layerId) {
        for (const n of Object.values(imageNodes)) {
          if (n.layerIds.includes(layerId)) { targetId = n.id; break; }
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
        data: { scopeKind: 'layer' as const },
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

  // Persist every node in `draggedNodes` back to the store. React Flow fires
  // drag-stop with the full array of nodes that moved — for a single drag it's
  // the one node; for a multi-select drag (click-and-drag a selected node, or
  // rubber-band selection drag) it's every node in the selection. Without the
  // loop only the primary node would persist and the others would snap back on
  // the next store→local-state sync.
  const persistDraggedPositions = useCallback((draggedNodes: Node[]) => {
    for (const n of draggedNodes) {
      if (n.type === 'image') editorDocument.workspace.setNodePosition(n.id, n.position);
      else if (n.type === 'widget') editorDocument.workspace.setWidgetPosition(n.id, n.position);
      else if (n.type === 'info')   editorDocument.workspace.setInfoNodePosition(n.id, n.position);
    }
  }, []);

  const { getIntersectingNodes } = useReactFlow();

  // During a drag, highlight the source node as a rejoin drop-target whenever an
  // extracted node hovers over it — the "release to rejoin" cue.
  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      const editor = useEditorStore.getState();
      let target: string | null = null;
      if (node.type === 'image') {
        const srcId = editor.imageNodes[node.id]?.sourceImageNodeId;
        const overlapIds = getIntersectingNodes(node).map((n) => n.id);
        target = rejoinTargetId(srcId, overlapIds);
      }
      if (editor.rejoinTargetNodeId !== target) editor.setRejoinTargetNodeId(target);
    },
    [getIntersectingNodes],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, draggedNodes: Node[]) => {
      useEditorStore.getState().setRejoinTargetNodeId(null); // clear the cue
      // Drag-to-rejoin: an extracted image node dropped onto its own source
      // merges back (the inverse of Extract to Image Node).
      if (node.type === 'image') {
        const editor = useEditorStore.getState();
        const srcId = editor.imageNodes[node.id]?.sourceImageNodeId;
        const overlapIds = getIntersectingNodes(node).map((n) => n.id);
        if (rejoinTargetId(srcId, overlapIds)) {
          const layerIds = editor.imageNodes[node.id]?.layerIds ?? [];
          const widgets = useBackendState.getState().snapshot?.widgets ?? [];
          const pending = useSuggestionsUi.getState().pendingSuggestionIds;
          if (nodeHasUnappliedChanges(widgets, pending, layerIds)) {
            toast.info('Apply or dismiss your changes before rejoining the source image.');
            persistDraggedPositions(draggedNodes); // leave it where dropped
            return;
          }
          rejoinSourceImage(node.id); // merges + un-crops; node is consumed
          return;
        }
      }
      persistDraggedPositions(draggedNodes);
    },
    [persistDraggedPositions, getIntersectingNodes],
  );

  const onSelectionDragStop = useCallback(
    (_: unknown, draggedNodes: Node[]) => {
      persistDraggedPositions(draggedNodes);
    },
    [persistDraggedPositions],
  );

  // Active image-node is set by EXPLICIT clicks only: click an image to focus,
  // click the pane (empty canvas) to clear. Drag-to-move does not change focus
  // (React Flow's selection state used to drive this and would activate on
  // drag-start, fighting the user). Clicks outside the React Flow surface
  // — e.g. inside the right sidebar — don't fire either handler and so leave
  // the focus untouched, which is what keeps the sidebar mounted while the
  // user is editing layer properties.
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type !== 'image') return;
      setActiveImageNode(node.id);
      // Sync activeLayerId to the clicked image-node's first photo layer so
      // the Adjustments tab targets this image's widgets (it filters via
      // useLayerWidgets(activeLayerId)). Without this, clicking a different
      // image leaves activeLayerId stale and slider writes hit the prior
      // image's widgets. Falls back to the first layerId of any kind if no
      // image layer exists.
      const state = useEditorStore.getState();
      const imageNode = state.imageNodes[node.id];
      if (!imageNode) return;
      const photoLayer =
        imageNode.layerIds.find(
          (lid) => state.layers.find((l) => l.id === lid)?.type === 'image',
        ) ?? imageNode.layerIds[0];
      if (photoLayer) state.setActiveLayer(photoLayer);
    },
    [setActiveImageNode],
  );
  const onPaneClick = useCallback(
    () => setActiveImageNode(null),
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
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        proOptions={{ hideAttribution: true }}
        minZoom={0.05}
        maxZoom={4}
        fitView
      >
        <Background color="var(--color-separator)" gap={16} size={1} />
        <Controls showInteractive={false} />
        <WorkspaceKeyHandler />
        <WorkspaceAutoFit />
      </ReactFlow>
    </div>
  );
}
