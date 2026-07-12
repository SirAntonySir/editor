import { useEffect, useMemo, useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useNodesInitialized,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type NodeChange,
  type EdgeChange,
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
import { pickTetherHandles, layerHandleForSide } from './tether-handles';
import {
  isValidTetherConnection, parseLayerHandle, imageNodeForLayer,
} from '@/lib/workspace-connect';
import type { Edge } from '@xyflow/react';
import { WIDGET_SHELL_MIN_WIDTH } from '@/components/widget/WidgetShell';
import { InfoNode, type InfoNodeData } from './InfoNode';
import { LayerNode, type LayerNodeData } from './LayerNode';
import { FusedSliceNode, type FusedSliceNodeData } from './FusedSliceNode';
import { layerNodeIdFor, fusedSliceEdgeIdFor } from '@/store/workspace-slice';
import { duplicateImageNode, duplicateActiveImageNode } from '@/lib/duplicate-image-node';
import { duplicateSelection } from '@/lib/duplicate-selection';
import type { Widget } from '@/types/widget';
import { rejoinSourceImage } from '@/lib/image-node-actions';
import { rejoinTargetByCenter } from '@/lib/workspace-drag';
import { useAiAccess } from '@/lib/ai-access';
import { deriveStrands, strandColorVarForCategory } from '@/lib/tether-strands';
import { loadRegistry } from '@/lib/registry/loader';

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

const nodeTypes = { image: ImageNodeWithBoundary, widget: WidgetNode, info: InfoNode, layers: LayerNode, fusedSlice: FusedSliceNode };
const edgeTypes = { tether: TetherEdge };

/**
 * Listens for Delete/Backspace and removes selected image and widget nodes.
 * Selected widget tethers (edges) are deleted by React Flow's own built-in
 * Delete handling, which fires `onEdgesDelete` (see CanvasWorkspace); this
 * handler only covers nodes. Rendered as a child of `<ReactFlow>` so
 * `useReactFlow` returns *this* flow's instance.
 */
function WorkspaceKeyHandler() {
  const { getNodes, getZoom, zoomTo, zoomIn, zoomOut, fitView } = useReactFlow();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      // Cmd/Ctrl+D — context-aware Duplicate of the current selection. This is
      // the canvas-scoped owner of the chord (there is no global Cmd+D), so a
      // multi-select can be duplicated as a group.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D') && !inField) {
        e.preventDefault();
        const selected = getNodes().filter((n) => n.selected);
        editorDocument.workspace.batch('Duplicate', () => {
          if (selected.length > 1) {
            duplicateSelection(selected.map((n) => n.id));
            return;
          }
          const one = selected[0];
          if (one?.type === 'image') duplicateImageNode(one.id);
          else if (one?.type === 'info') useEditorStore.getState().duplicateInfoNode(one.id);
          else duplicateActiveImageNode(); // nothing (or a widget) selected → active node
        });
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (inField) return;

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
    // Keep the editor-store zoom roughly in sync for the status bar. Coalesce to
    // one write per frame — a wheel gesture fires dozens of events per second
    // and each setZoom notifies every zoom subscriber.
    let scrollRaf = 0;
    const onPaneScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        useEditorStore.getState().setZoom(getZoom());
      });
    };

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
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
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
      fitView({ padding: 0.18, duration: 300 });
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
type LayerNodeType = Node<LayerNodeData, 'layers'>;
type FusedSliceNodeType = Node<FusedSliceNodeData, 'fusedSlice'>;
type WorkspaceNode = ImageNodeType | WidgetNodeType | InfoNodeType | LayerNodeType | FusedSliceNodeType;

export function CanvasWorkspace() {
  const imageNodes = useEditorStore((s) => s.imageNodes);
  const widgetNodes = useEditorStore((s) => s.widgetNodes);
  const infoNodes = useEditorStore((s) => s.infoNodes);
  const layerNodes = useEditorStore((s) => s.layerNodes);
  const fusedSliceNodes = useEditorStore((s) => s.fusedSliceNodes);
  const ensureLayerNode = useEditorStore((s) => s.ensureLayerNode);
  const layers = useEditorStore((s) => s.layers);
  const documentMeta = useEditorStore((s) => s.documentMeta);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const snapshotWidgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  // Study condition: the layers node is a working-with-widgets affordance,
  // withheld from the baseline (aiAccess=false) alongside the other AI surfaces.
  const aiAccess = useAiAccess();
  const tetherEdges = useEditorStore((s) => s.tetherEdges);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);
  const addImageNode = useEditorStore((s) => s.addImageNode);
  const syncWidgetTethers = useEditorStore((s) => s.syncWidgetTethers);
  const addWidgetTarget = useEditorStore((s) => s.addWidgetTarget);
  const retargetWidget = useEditorStore((s) => s.retargetWidget);
  const removeWidgetTarget = useEditorStore((s) => s.removeWidgetTarget);

  // Reconcile the optimistic tetherEdges mirror against the backend snapshot
  // (widget.nodes[].layerIds). Runs when widgets or node membership change;
  // does NOT depend on tetherEdges, so it never loops on its own write.
  useEffect(() => {
    syncWidgetTethers(snapshotWidgets);
  }, [snapshotWidgets, imageNodes, syncWidgetTethers]);

  // Back-fill a layers node for any image node missing one. Covers sessions
  // restored before layers nodes existed, and the rehydrate path (which sets
  // `imageNodes` directly rather than via addImageNode). New nodes created at
  // runtime already get their layers node from the slice lifecycle ops.
  useEffect(() => {
    for (const id of Object.keys(imageNodes)) {
      if (!layerNodes[layerNodeIdFor(id)]) ensureLayerNode(id);
    }
  }, [imageNodes, layerNodes, ensureLayerNode]);

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
    // Layers nodes — one per image node, SHOWN only when the node has more than
    // one layer AND the AI widget layer is enabled. A single-layer node's strip
    // is redundant (the sole layer is the image itself); and in the baseline
    // study condition (aiAccess=false) the layers node is withheld like the
    // other working-with-widgets affordances, so layer control there runs
    // through the inspector's Layer tab. The store entry survives either way, so
    // the strip re-appears once a second layer is added or AI is enabled.
    const layerStrips: LayerNodeType[] = Object.values(layerNodes)
      .filter((n) => aiAccess && (imageNodes[n.imageNodeId]?.layerIds.length ?? 0) > 1)
      .map((n) => ({
        id: n.id,
        type: 'layers',
        position: n.position,
        // The whole strip card is the drag handle; per-row buttons stopPropagation.
        dragHandle: '.workspace-drag-handle',
        data: { imageNodeId: n.imageNodeId },
      }));
    // Break-out projection satellites — one per fused-slice node whose parent
    // widget is still an active fused widget in the snapshot. The node itself
    // does the fine-grained prune (op-node gone → self-remove); this filter
    // avoids even mounting a satellite whose parent widget has been dismissed.
    const activeWidgetIds = new Set(
      snapshotWidgets.filter((w) => w.status === 'active').map((w) => w.id),
    );
    const slices: FusedSliceNodeType[] = Object.values(fusedSliceNodes)
      .filter((n) => activeWidgetIds.has(n.parentWidgetId))
      .map((n) => ({
        id: n.id,
        type: 'fusedSlice',
        position: n.position,
        dragHandle: '.workspace-drag-handle',
        data: { sliceId: n.id },
      }));
    return [...imgs, ...widgets, ...infos, ...layerStrips, ...slices];
  }, [imageNodes, widgetNodes, snapshotWidgets, infoNodes, layerNodes, fusedSliceNodes, layers, aiAccess]);

  // Local RF state mirrors the store. React Flow needs to own positions during
  // drag (via onNodesChange) so the visual position follows the cursor without
  // snap-back on re-renders. Drag-stop persists back to the store.
  const [nodes, setNodes] = useState<WorkspaceNode[]>(storeNodes);
  useEffect(() => {
    // Rebuilding nodes from the store on every change would wipe React Flow's
    // per-node `selected` flag (it lives only in RF's local state), which
    // unmounts selection-gated affordances like the resize handles mid-drag.
    // Preserve `selected` by id across the resync.
    setNodes((prev) => {
      const selectedIds = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return selectedIds.size === 0
        ? storeNodes
        : storeNodes.map((n) => (selectedIds.has(n.id) ? { ...n, selected: true } : n));
    });
  }, [storeNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev) as WorkspaceNode[]);
    // Persist React-Flow-measured widget sizes so spawn-placement collision
    // (workspace-tether) avoids each widget's REAL expanded footprint instead
    // of a fixed header estimate. Dimension changes are event-driven (RF emits
    // them on measure/resize), so this doesn't run on every render.
    const st = useEditorStore.getState();
    for (const c of changes) {
      if (c.type !== 'dimensions' || !c.dimensions) continue;
      const w = c.dimensions.width;
      const h = c.dimensions.height;
      const wNode = st.widgetNodes[c.id];
      if (wNode) {
        if (!wNode.size || Math.abs(wNode.size.w - w) > 1 || Math.abs(wNode.size.h - h) > 1) {
          st.setWidgetSize(c.id, { w, h });
        }
        continue;
      }
      // Break-out satellites persist their measured size too, so the hub tether
      // routes to the real extent.
      const sNode = st.fusedSliceNodes[c.id];
      if (sNode && (!sNode.size || Math.abs(sNode.size.w - w) > 1 || Math.abs(sNode.size.h - h) > 1)) {
        st.setFusedSliceNodeSize(c.id, { w, h });
      }
    }
  }, []);

  // Edges are auto-derived from active widgets. Each widget gets one edge to
  // the image node it belongs to: resolve via the first node's layerId and
  // fall back to the active image node.
  const derivedEdges = useMemo<TetherEdgeType[]>(() => {
    const out: TetherEdgeType[] = [];

    // Widget lookup for braid-strand derivation. Strands depend on
    // widget.compound, node op categories, and lockedParams — all reactive via
    // snapshotWidgets — so they must be recomputed here per render, not stored.
    const widgetById = new Map<string, Widget>(snapshotWidgets.map((w) => [w.id, w]));

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
      } else if (n.type === 'layers') {
        // Layers nodes size with layer count; prefer measured, fall back to
        // the persisted size, then a sensible default.
        const persisted = layerNodes[n.id]?.size;
        w = n.measured?.width  ?? persisted?.w ?? 150;
        h = n.measured?.height ?? persisted?.h ?? 80;
      } else if (n.type === 'fusedSlice') {
        // Break-out satellites size with their op panel; prefer measured, fall
        // back to the persisted size, then the shell min width / a body estimate.
        const persisted = fusedSliceNodes[n.id]?.size;
        w = n.measured?.width  ?? persisted?.w ?? WIDGET_SHELL_MIN_WIDTH;
        h = n.measured?.height ?? persisted?.h ?? 120;
      } else {
        w = n.measured?.width  ?? (n.data as ImageNodeData).size.w;
        h = n.measured?.height ?? (n.data as ImageNodeData).size.h;
      }
      rfLookup.set(n.id, { position: n.position, size: { w, h } });
    }

    // Widget tethers: one edge per (widget, layer) target, from the optimistic
    // tetherEdges mirror (reconciled from the snapshot by syncWidgetTethers).
    // The target is the specific per-layer RAIL handle; pickTetherHandles picks
    // only the widget's OUTLET side (its target-handle result is discarded).
    for (const te of Object.values(tetherEdges)) {
      // The per-layer tether ports live on the standalone layers node — but that
      // node is only SHOWN for multi-layer image nodes. When it's hidden
      // (single-layer node), the widget tether falls back to the image node's
      // generic `tether-in` handle so the connection stays visible. Either way
      // the stored scope (`targetImageNodeId` + layerId) is unchanged.
      const layersNodeId = layerNodeIdFor(te.targetImageNodeId);
      const layersShown = rfLookup.has(layersNodeId);
      const targetNodeId = layersShown ? layersNodeId : te.targetImageNodeId;
      const rfWidget = rfLookup.get(te.widgetNodeId);
      const rfTarget = rfLookup.get(targetNodeId);
      if (!rfWidget || !rfTarget) continue;

      const widgetCenter = {
        x: rfWidget.position.x + rfWidget.size.w / 2,
        y: rfWidget.position.y + rfWidget.size.h / 2,
      };
      const targetBounds = {
        x0: rfTarget.position.x,
        y0: rfTarget.position.y,
        x1: rfTarget.position.x + rfTarget.size.w,
        y1: rfTarget.position.y + rfTarget.size.h,
      };
      const { sourceHandle, targetHandle: side } = pickTetherHandles(widgetCenter, targetBounds);
      // Braid strands: only fused widgets (widget.compound) produce them.
      // Non-fused → undefined → TetherEdge renders the single accent path.
      const teWidget = widgetById.get(te.widgetNodeId);
      const strands = teWidget ? deriveStrands(teWidget) : [];
      out.push({
        id: te.id,
        source: te.widgetNodeId,
        target: targetNodeId,
        sourceHandle,
        // The per-layer port `layer-tether-<layerId>`. On the layers node
        // (multi-layer) there is one port, so use the base id. On the image
        // body (single-layer) the port is mirrored on all four sides, so land
        // on the side nearest the widget.
        targetHandle: layersShown
          ? `layer-tether-${te.layerId}`
          : layerHandleForSide(te.layerId, side),
        // Only the target end reconnects — the source is always the widget.
        reconnectable: 'target',
        type: 'tether',
        data: {
          scopeKind: 'layer' as const,
          widgetId: te.widgetNodeId,
          layerId: te.layerId,
          ...(strands.length > 0 ? { strands } : {}),
        },
        selectable: true, // selectable so ⌫ can remove a single target
      });
    }

    // ─── Layers-node → image-node attribution tethers ───────────────
    // A calm, non-selectable connector grouping each layers node with its
    // image node. Purely visual (scopeKind 'node') — no DAG semantics.
    for (const ln of Object.values(layerNodes)) {
      if (!imageNodes[ln.imageNodeId]) continue;
      const rfLayers = rfLookup.get(ln.id);
      const rfImage = rfLookup.get(ln.imageNodeId);
      if (!rfLayers || !rfImage) continue;
      const layersCenter = {
        x: rfLayers.position.x + rfLayers.size.w / 2,
        y: rfLayers.position.y + rfLayers.size.h / 2,
      };
      const imageBounds = {
        x0: rfImage.position.x,
        y0: rfImage.position.y,
        x1: rfImage.position.x + rfImage.size.w,
        y1: rfImage.position.y + rfImage.size.h,
      };
      const { sourceHandle, targetHandle } = pickTetherHandles(layersCenter, imageBounds);
      out.push({
        id: `layers-link-${ln.imageNodeId}`,
        source: ln.id,
        target: ln.imageNodeId,
        sourceHandle,
        targetHandle,
        type: 'tether',
        data: { scopeKind: 'node' },
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

    // ─── Break-out satellite hub tethers ───────────────────────────
    // Each fused-slice satellite tethers to its PARENT WIDGET node (the hub),
    // not to the image — the braid from the intent widget to the photo stays
    // whole. Only render when both endpoints exist in RF (parent widget node
    // present + satellite mounted). Edge id `hub:<sliceId>`.
    for (const slice of Object.values(fusedSliceNodes)) {
      const rfSlice = rfLookup.get(slice.id);
      const rfParent = rfLookup.get(slice.parentWidgetId);
      if (!rfSlice || !rfParent) continue;
      const sliceCenter = {
        x: rfSlice.position.x + rfSlice.size.w / 2,
        y: rfSlice.position.y + rfSlice.size.h / 2,
      };
      const parentBounds = {
        x0: rfParent.position.x,
        y0: rfParent.position.y,
        x1: rfParent.position.x + rfParent.size.w,
        y1: rfParent.position.y + rfParent.size.h,
      };
      const { sourceHandle, targetHandle } = pickTetherHandles(sliceCenter, parentBounds);
      // The parent widget node exposes only `tether-out-*` handles (no
      // `tether-in-*`), so remap the picked image-style target side to the
      // widget's outlet on the same side — the edge just anchors to that
      // handle's position.
      const parentSide = targetHandle.slice('tether-in-'.length);
      // Hub tint: stroke the satellite→hub tether with the op's category token,
      // so a break-out reads as "this strand, lifted onto the canvas".
      const parentWidget = widgetById.get(slice.parentWidgetId);
      const node = parentWidget?.nodes.find((n) => n.id === slice.nodeId);
      const reg = loadRegistry();
      const op = node?.opId
        ? reg.ops[node.opId]
        : node
          ? Object.values(reg.ops).find((o) => o.engine.node_type === node.type)
          : undefined;
      const strandColorVar = strandColorVarForCategory(op?.category);
      out.push({
        id: fusedSliceEdgeIdFor(slice.id),
        source: slice.id,
        target: slice.parentWidgetId,
        sourceHandle,
        targetHandle: `tether-out-${parentSide}`,
        type: 'tether',
        data: { scopeKind: 'node', variant: 'hub' as const, strandColorVar },
        selectable: false,
      });
    }

    // ─── Extracted-object provenance tethers ───────────────────────
    // Every image node extracted from a source (`sourceImageNodeId`) gets a
    // calm, semi-transparent grey connector back to that source, so the cutout
    // visibly reads as "came from here". Same handle-routing as the others.
    for (const node of Object.values(imageNodes)) {
      const srcId = node.sourceImageNodeId;
      if (!srcId || !imageNodes[srcId]) continue;
      const rfNode = rfLookup.get(node.id);
      const rfSrc = rfLookup.get(srcId);
      if (!rfNode || !rfSrc) continue;
      const nodeCenter = {
        x: rfNode.position.x + rfNode.size.w / 2,
        y: rfNode.position.y + rfNode.size.h / 2,
      };
      const srcBounds = {
        x0: rfSrc.position.x,
        y0: rfSrc.position.y,
        x1: rfSrc.position.x + rfSrc.size.w,
        y1: rfSrc.position.y + rfSrc.size.h,
      };
      const { sourceHandle, targetHandle } = pickTetherHandles(nodeCenter, srcBounds);
      out.push({
        id: `extracted-${node.id}`,
        source: node.id,
        target: srcId,
        sourceHandle,
        targetHandle,
        type: 'tether',
        data: { scopeKind: 'node', variant: 'extracted' as const },
        selectable: false,
      });
    }
    return out;
  }, [tetherEdges, imageNodes, infoNodes, layerNodes, fusedSliceNodes, nodes, snapshotWidgets]);

  // Local RF edge state mirrors the derived edges. React Flow owns edge
  // `selected` state (needed so a click can select a tether and ⌫ can delete
  // it), but our edges are re-derived from the store on every render — which
  // would wipe that flag. So we mirror the same selection-preservation dance
  // the nodes use: keep a local copy, apply React Flow's change events to it,
  // and re-graft `selected` by id when the derived geometry updates.
  const [edges, setEdges] = useState<TetherEdgeType[]>(derivedEdges);
  useEffect(() => {
    setEdges((prev) => {
      const selectedIds = new Set(prev.filter((e) => e.selected).map((e) => e.id));
      return selectedIds.size === 0
        ? derivedEdges
        : derivedEdges.map((e) => (selectedIds.has(e.id) ? { ...e, selected: true } : e));
    });
  }, [derivedEdges]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((prev) => applyEdgeChanges(changes, prev) as TetherEdgeType[]);
  }, []);

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
      else if (n.type === 'layers') editorDocument.workspace.setLayerNodePosition(n.id, n.position);
      // Satellite drags are pure UI (frontend-only), so persist straight to the
      // slice rather than through the undoable workspace facade.
      else if (n.type === 'fusedSlice') useEditorStore.getState().setFusedSliceNodePosition(n.id, n.position);
    }
  }, []);

  // Rejoin target for a node being dragged: tight, center-based hitbox — the
  // dragged node's CENTER must sit over its own source image (not React Flow's
  // generous partial-overlap). `node.position` is the live drag position; size
  // comes from the store. Returns the source id or null.
  const rejoinTargetFor = useCallback((node: Node): string | null => {
    if (node.type !== 'image') return null;
    const editor = useEditorStore.getState();
    const dragged = editor.imageNodes[node.id];
    const srcId = dragged?.sourceImageNodeId;
    const src = srcId ? editor.imageNodes[srcId] : undefined;
    if (!dragged || !src) return null;
    return rejoinTargetByCenter(
      srcId,
      { position: node.position, size: dragged.size },
      { position: src.position, size: src.size },
    );
  }, []);

  // During a drag, highlight the source node as a rejoin drop-target whenever an
  // extracted node's center is over it — the "release to rejoin" cue.
  const onNodeDrag = useCallback(
    (_: unknown, node: Node) => {
      const target = rejoinTargetFor(node);
      const editor = useEditorStore.getState();
      if (editor.rejoinTargetNodeId !== target) editor.setRejoinTargetNodeId(target);
    },
    [rejoinTargetFor],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node, draggedNodes: Node[]) => {
      useEditorStore.getState().setRejoinTargetNodeId(null); // clear the cue
      // Drag-to-rejoin: an extracted image node dropped (center) onto its own
      // source merges back (the inverse of Extract to Image Node).
      if (node.type === 'image') {
        if (rejoinTargetFor(node)) {
          // Rejoin unconditionally: mergeImageNodes carries the layers (and the
          // live widgets tethered to them) into the source node, so there's
          // nothing to apply/dismiss first — the widgets simply follow the layer.
          rejoinSourceImage(node.id); // merges + un-crops; node is consumed
          return;
        }
      }
      persistDraggedPositions(draggedNodes);
    },
    [persistDraggedPositions, rejoinTargetFor],
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

  // ─── Tether connect / reconnect / delete ───────────────────────────
  // All three write to the optimistic tetherEdges mirror for instant feedback
  // AND call the backend update_widget_targets tool (the source of truth). The
  // snapshot round-trip + syncWidgetTethers reconcile.
  const sid = () => useBackendState.getState().sessionId;

  const isValidConnection = useCallback((conn: Connection | Edge): boolean => {
    const st = useEditorStore.getState();
    const widgetIds = new Set(
      useBackendState.getState().snapshot?.widgets
        .filter((w) => w.status === 'active').map((w) => w.id) ?? [],
    );
    return isValidTetherConnection(conn, { widgetIds, tetherEdges: st.tetherEdges });
  }, []);

  const onConnect = useCallback((conn: Connection) => {
    if (!isValidConnection(conn)) return;
    const layerId = parseLayerHandle(conn.targetHandle);
    const widgetId = conn.source;
    if (!layerId || !widgetId) return;
    // `conn.target` is the layers node now, not the image node — resolve the
    // owning image node from the (globally unique) layer id.
    const imageNodeId = imageNodeForLayer(useEditorStore.getState().imageNodes, layerId);
    if (!imageNodeId) return;
    addWidgetTarget(widgetId, imageNodeId, layerId);
    const s = sid();
    if (s) void backendTools.update_widget_targets(s, { widgetId, op: 'add', layerId });
  }, [isValidConnection, addWidgetTarget]);

  // Reconnect: dragging a tether's TARGET end to another rail handle.
  const reconnectDone = useRef(false);
  const onReconnectStart = useCallback(() => { reconnectDone.current = false; }, []);

  const onReconnect = useCallback((oldEdge: Edge, conn: Connection) => {
    if (!isValidConnection(conn)) return;
    const newLayerId = parseLayerHandle(conn.targetHandle);
    const data = oldEdge.data as { widgetId?: string; layerId?: string } | undefined;
    const widgetId = data?.widgetId ?? oldEdge.source;
    const fromLayerId = data?.layerId;
    if (!newLayerId || !widgetId || !fromLayerId) return;
    // `conn.target` is the layers node now — resolve the image node from the layer.
    const imageNodeId = imageNodeForLayer(useEditorStore.getState().imageNodes, newLayerId);
    if (!imageNodeId) return;
    reconnectDone.current = true;
    retargetWidget(oldEdge.id, imageNodeId, newLayerId);
    const s = sid();
    if (s) void backendTools.update_widget_targets(s, { widgetId, op: 'retarget', layerId: newLayerId, fromLayerId });
  }, [isValidConnection, retargetWidget]);

  // Dropped on empty space → remove that one target.
  const onReconnectEnd = useCallback((_e: unknown, edge: Edge) => {
    if (reconnectDone.current) return;
    if (!edge.id.startsWith('te-')) return;
    const data = edge.data as { widgetId?: string; layerId?: string } | undefined;
    const widgetId = data?.widgetId ?? edge.source;
    const layerId = data?.layerId;
    removeWidgetTarget(edge.id);
    const s = sid();
    if (s && widgetId && layerId) void backendTools.update_widget_targets(s, { widgetId, op: 'remove', layerId });
  }, [removeWidgetTarget]);

  // Select a tether + ⌫ → remove that one target.
  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    const s = sid();
    for (const edge of deleted) {
      if (!edge.id.startsWith('te-')) continue; // ignore info/extracted edges
      const data = edge.data as { widgetId?: string; layerId?: string } | undefined;
      const widgetId = data?.widgetId ?? edge.source;
      const layerId = data?.layerId;
      removeWidgetTarget(edge.id);
      if (s && widgetId && layerId) void backendTools.update_widget_targets(s, { widgetId, op: 'remove', layerId });
    }
  }, [removeWidgetTarget]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStop={onSelectionDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onReconnectStart={onReconnectStart}
        onReconnect={onReconnect}
        onReconnectEnd={onReconnectEnd}
        onEdgesDelete={onEdgesDelete}
        edgesReconnectable
        reconnectRadius={20}
        connectionRadius={30}
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
