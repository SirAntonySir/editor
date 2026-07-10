/**
 * EditorDocument — the unified state machine / facade.
 *
 * Coordinates: Zustand store, PixelStore, and HistoryManager.
 */
import type { StoreApi } from 'zustand';
import type {
  DocumentMeta,
  SerializableState,
  InteractionSession,
} from './types';
import type { EditorState } from '@/store';
import type { InfoNodeContent, InfoNodeState, Point, Size, TetherEdgeState } from '@/types/workspace';
import { pixelStore } from './pixel-store';
import { hiBitStore } from './hibit-store';
import { isPng16, decodePng16, sniffPng16 } from '@/lib/png16';
import * as history from './history';
import { putSource } from './pixel-source-store';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { autoAnalyseImageOnLoad, useAiSession } from '@/hooks/useImageContext';
import { resetSegmentationClientState } from '@/lib/segmentation/reset-client-state';
import { clearInternalCanvasCache } from '@/lib/image-node-geometry';
import { mergeVisibleLayersBody } from '@/lib/merge-visible-layers';
import { downscaleForUpload, yieldToDisplay } from '@/lib/downscale-for-upload';
import { parseImageMetadata } from '@/lib/image-metadata';
import { backendTools } from '@/lib/backend-tools';
import { toast } from '@/components/ui/Toast';

import { BACKEND_BASE_URL } from '@/lib/backend-url';
import { logWidgetUndoDiag } from '@/lib/widget-undo-diag';

const DEBOUNCE_MS = 2000;

// ─── Burst-coalesce toast for non-stealing image adds ───────────────
const BURST_WINDOW_MS = 250;
let pendingImageAdds = 0;
let imageAddFlush: ReturnType<typeof setTimeout> | null = null;

function notifyImageAdded(): void {
  pendingImageAdds += 1;
  if (imageAddFlush !== null) return;
  imageAddFlush = setTimeout(() => {
    const n = pendingImageAdds;
    pendingImageAdds = 0;
    imageAddFlush = null;
    toast.info(n === 1 ? 'Image added — click to edit.' : `${n} images added — click to edit.`);
  }, BURST_WINDOW_MS);
}

/** Reset burst-coalesce state. Exported for test isolation only. */
export function _resetImageAddBurst(): void {
  if (imageAddFlush !== null) {
    clearTimeout(imageAddFlush);
    imageAddFlush = null;
  }
  pendingImageAdds = 0;
}
// ────────────────────────────────────────────────────────────────────

let store: StoreApi<EditorState> | null = null;
let interaction: InteractionSession | null = null;

// ─── Deep equality (handles Float32Array) ───────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (a instanceof Float32Array && b instanceof Float32Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    if (aKeys.length !== Object.keys(bObj).length) return false;
    for (const key of aKeys) {
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

function statesChanged(a: SerializableState, b: SerializableState): boolean {
  return a.activeLayerId !== b.activeLayerId ||
    a.pixelVersion !== b.pixelVersion ||
    a.activeImageNodeId !== b.activeImageNodeId ||
    !deepEqual(a.layers, b.layers) ||
    !deepEqual(a.imageNodes, b.imageNodes) ||
    !deepEqual(a.widgetNodes, b.widgetNodes) ||
    !deepEqual(a.tetherEdges, b.tetherEdges) ||
    !deepEqual(a.infoNodes, b.infoNodes);
}

// ─── State capture / restore ────────────────────────────────────────

function captureState(): SerializableState | null {
  if (!store) return null;
  const s = store.getState();
  return {
    layers: structuredClone(s.layers),
    activeLayerId: s.activeLayerId,
    pixelVersion: s.pixelVersion,
    imageNodes: structuredClone(s.imageNodes),
    widgetNodes: structuredClone(s.widgetNodes),
    tetherEdges: structuredClone(s.tetherEdges),
    infoNodes: structuredClone(s.infoNodes),
    layerNodes: structuredClone(s.layerNodes),
    activeImageNodeId: s.activeImageNodeId,
  };
}

function restoreState(snapshot: SerializableState): void {
  if (!store) return;
  store.setState({
    layers: snapshot.layers,
    activeLayerId: snapshot.activeLayerId,
    pixelVersion: snapshot.pixelVersion,
    imageNodes: snapshot.imageNodes,
    widgetNodes: snapshot.widgetNodes,
    tetherEdges: snapshot.tetherEdges,
    // Tolerate older snapshots that pre-date the infoNodes field.
    infoNodes: snapshot.infoNodes ?? {},
    // Tolerate older snapshots from before layers nodes existed — CanvasWorkspace
    // back-fills any missing ones from the restored imageNodes.
    layerNodes: snapshot.layerNodes ?? {},
    activeImageNodeId: snapshot.activeImageNodeId,
  });
  // `_nextNodeSeq` isn't part of the serialized history snapshot; re-derive it
  // from the restored node ids so a post-undo addImageNode can't mint a
  // colliding id and clobber a restored node.
  store.getState().resyncNodeSeq();
}

function markDirty(): void {
  if (store) store.setState({ isDirty: true });
}


// ─── Initialization ─────────────────────────────────────────────────

function init(zustandStore: StoreApi<EditorState>): void {
  store = zustandStore;
}

function dispose(): void {
  store = null;
}

// ─── Document lifecycle ─────────────────────────────────────────────

function newDocument(): void {
  pixelStore.clear();
  hiBitStore.clear();
  history.clear();
  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name: 'Untitled',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: 0,
    height: 0,
  };

  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      documentMeta: meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  const seed = captureState();
  if (seed) history.initWith(seed);
}

/**
 * Reset back to the no-document state: clears layers, workspace nodes/edges,
 * pixel data, history, and the persisted backend session (incl. its
 * localStorage entry). Used by the image-node Delete action so the user can
 * upload a fresh image and re-run analyze from scratch — info tab and AI
 * suggestions all clear with the snapshot.
 */
function closeDocument(): void {
  pixelStore.clear();
  hiBitStore.clear();
  history.clear();
  // Client segmentation state (SAM embedding caches, maskStore, ownership)
  // is keyed by image-node id, and resetWorkspace below RECYCLES those ids
  // (counter restarts at in-1). Without this, the next opened image inherits
  // the prior image's embedding — SAM decodes the old image's masks onto it.
  resetSegmentationClientState();
  // Drops session id from in-memory state + localStorage and clears snapshot,
  // so the info tab's image_context, regions, and AI suggestions all reset.
  useBackendState.getState().reset();
  // Workspace: image nodes, widget nodes, tether edges, active selection.
  useEditorStore.getState().resetWorkspace();
  clearInternalCanvasCache();
  if (store) {
    store.setState({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      documentMeta: null,
      isDirty: false,
    });
  }
}

/**
 * Original-source identity for a file whose decoded bytes differ from what the
 * user opened — e.g. a camera RAW developed to a PNG internally. Lets the
 * editor present it as the RAW (name / format / size) instead of the transport.
 */
export interface SourceMeta {
  name: string;
  format: string;
  fileSize: number;
}

/**
 * If `file` is a 16-bit PNG (the RAW develop path produces these), decode its
 * high-bit pixels and register them in the hi-bit store for this layer, so the
 * float pipeline can read them. Best-effort: any failure leaves the layer on
 * the normal 8-bit canvas — no regression.
 */
async function maybeRegisterHiBit(layerId: string, file: File): Promise<void> {
  try {
    // Header sniff first (26 bytes) — the open path must not read a 40 MB
    // JPEG's full bytes just to learn it isn't a PNG. Only a positive sniff
    // pays for the full read + uint16 decode.
    if (!(await sniffPng16(file))) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isPng16(bytes)) return;
    hiBitStore.register(layerId, decodePng16(bytes));
  } catch (err) {
    console.warn('[hibit] 16-bit decode failed, staying 8-bit:', err);
  }
}

async function openImage(file: File, source?: SourceMeta): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  // EXIF / GPS parse — best-effort, swallows errors. Runs in parallel with
  // the canvas decode above (which has already completed by the time we
  // await here). Net cost: ~few ms for a typical 5–25 MB JPEG.
  const metadata = (await parseImageMetadata(file)) ?? undefined;

  // Reset state
  pixelStore.clear();
  hiBitStore.clear();
  history.clear();
  // Same reasoning as closeDocument: everything keyed by layer/node id is
  // about to be replaced — stale SAM embeddings + masks must not survive.
  resetSegmentationClientState();

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);
  // Fire-and-forget: hi-bit pixels are only consulted when an adjustment
  // renders through the float pipeline, so registration may land after first
  // paint. Keeping this off the awaited path spares the open of a large
  // PNG16 its full-file read + decode before the image can show.
  void maybeRegisterHiBit(layerId, file);

  // Display identity: a developed RAW carries `source` (its original .ARW name
  // / format / size) so the editor presents it as the RAW, not the internal
  // PNG transport. Falls back to the file's own fields otherwise.
  const displayName = source?.name ?? file.name;
  const meta: DocumentMeta = {
    id: crypto.randomUUID(),
    name: displayName.replace(/\.[^.]+$/, ''),
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    width: bitmap.width,
    height: bitmap.height,
    // Native File fields — kept so the Info tab can show format + size
    // without re-reading the blob. Empty `file.type` falls back to undefined
    // (some sources like clipboard paste leave it blank).
    mimeType: file.type || undefined,
    format: source?.format,
    fileSize: source?.fileSize ?? file.size,
    metadata,
  };

  if (store) {
    store.setState({
      layers: [
        {
          id: layerId,
          type: 'image',
          name: displayName,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: 0,
        },
      ],
      activeLayerId: layerId,
      pixelVersion: 0,
      documentMeta: meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  const seed = captureState();
  if (seed) history.initWith(seed);

  // Kick off backend session bootstrap so the toolrail adjustments work
  // immediately — analyse runs later, on explicit user click. Awaiting
  // would block image-open on a backend round-trip, so fire-and-forget.
  // Pass the OffscreenCanvas (not `bitmap` — closed below; not `file` —
  // openSession's downscaleForUpload doesn't accept Blob).
  // Reset useAiSession first: openSession early-returns when sessionId is
  // already set, so without a reset a new image would either skip the
  // upload entirely (re-opening) or inherit a stuck 'uploading'/'error'
  // status from a previous attempt (backend reload, network blip).
  //
  // NOTE: openSession is async (uploads the offscreen canvas). If the user
  // opens a second image while a prior upload is still in flight, the late
  // upload can clobber the new session. Addressing that race requires a
  // generation counter on useAiSession.openSession — out of scope for this
  // cluster, tracked as a follow-up under audit C8.
  useAiSession.getState().reset();
  void useAiSession
    .getState()
    .openSession(offscreen)
    .then(() => {
      // openSession sets useAiSession.sessionId before resolving. Persist
      // the source blob here (not synchronously above) because the session
      // didn't exist yet at openImage entry — without this, Cmd+R reload
      // finds no IDB entry and the canvas paints gray.
      const sid = useAiSession.getState().sessionId;
      if (sid) void putSource(sid, layerId, file);
      // Auto-analyze on user load (mechanical + semantic + problems, no
      // suggestions). Fire-and-forget: its own gates (aiAccess / SSE /
      // existing context) decide whether anything actually runs, and a
      // failure just leaves the menu's "Analyze with AI" as the retry.
      // Reloads never reach this — they rehydrate, they don't openImage.
      if (sid) void autoAnalyseImageOnLoad();
    });

  bitmap.close();
}

/**
 * Append a second (or Nth) image to the current document/session without
 * resetting any existing state. Creates a new layer + image node placed to
 * the right of the existing ones.
 *
 * Fire-and-forget backend upload: posts the file to
 * `/api/session/{sid}/images`. The backend mints its own image_node_id;
 * the frontend separately mints a workspace id via `addImageNode`. For
 * this slice we accept that the two ids may not match — revival will
 * reconcile.
 */
async function addImage(file: File, source?: SourceMeta): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);
  // Fire-and-forget: hi-bit pixels are only consulted when an adjustment
  // renders through the float pipeline, so registration may land after first
  // paint. Keeping this off the awaited path spares the open of a large
  // PNG16 its full-file read + decode before the image can show.
  void maybeRegisterHiBit(layerId, file);

  // Persist the source blob + upload to the backend once a session is
  // available. During a multi-file Finder drop, addImage can run BEFORE the
  // first image's async `openSession` has propagated its id to
  // useBackendState — reading it synchronously here would be null, silently
  // dropping both persistence and upload, so those images came back gray on
  // reload. Await the bootstrapping session (resolves immediately when one is
  // already live, `null` when none is coming) and key persistence off it.
  // Deferred (fire-and-forget) so the visible workspace node below is not
  // blocked on the backend round-trip.
  void (async () => {
    const sid =
      useBackendState.getState().sessionId ??
      (await useAiSession.getState().awaitSession());
    if (!sid) return;

    // Best-effort persist source blob so revival can rehydrate this layer.
    void putSource(sid, layerId, file);

    // Best-effort backend upload. Downscale first like the initial-load path
    // (useImageContext): the backend only needs a context copy and enforces
    // MAX_IMAGE_BYTES (2MB), so uploading a raw full-res image here would 413.
    // Full resolution stays in the local pixelStore for editing.
    try {
      // Same paint courtesy as openSession: the new node is mounting right
      // now — don't run the O(source-pixels) downscale against its first frame.
      await yieldToDisplay();
      const blob = await downscaleForUpload(offscreen);
      const fd = new FormData();
      fd.append('image', blob, 'image.jpg');
      const resp = await fetch(`${BACKEND_BASE_URL}/api/session/${sid}/images`, {
        method: 'POST',
        body: fd,
      });
      if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
      // Auto-analyze on user load — same fire-and-forget as openImage. When
      // the session already has context (the usual case: the first image was
      // auto-analyzed) the gate skips, and this node reads as analysed via
      // the session-context union. Only a context-less session (e.g. add on
      // an empty canvas) actually analyzes here.
      void autoAnalyseImageOnLoad();
    } catch (err) {
      console.warn('[addImage] backend upload failed:', err);
    }
  })();

  if (store) {
    const existing = Object.values(store.getState().imageNodes);
    const maxRight = existing.reduce(
      (m, n) => Math.max(m, n.position.x + n.size.w),
      0,
    );
    const position = { x: existing.length > 0 ? maxRight + 80 : 0, y: 0 };

    const wasNothingActive = useEditorStore.getState().activeImageNodeId === null;

    const newNodeId = useEditorStore.getState().addImageNode(
      [layerId],
      position,
      { w: bitmap.width, h: bitmap.height },
    );

    store.setState((s) => ({
      layers: [
        ...s.layers,
        {
          id: layerId,
          type: 'image',
          name: source?.name ?? file.name,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          locked: false,
          order: s.layers.length,
        },
      ],
      // Only adopt the new layer as active when nothing was active —
      // preserves the user's selection when they add a second image.
      ...(wasNothingActive ? { activeLayerId: layerId } : {}),
    }));

    // Promote the new node to active ONLY when there's nothing to preserve.
    if (wasNothingActive) {
      useEditorStore.getState().setActiveImageNode(newNodeId);
    } else {
      notifyImageAdded();
    }
  }

  const post = captureState();
  if (post) history.push(post);
  markDirty();

  bitmap.close();
}

// ─── Interaction sessions (slider debouncing) ───────────────────────

function beginInteraction(label: string): void {
  const pre = captureState();
  if (!pre) return;
  if (interaction) {
    // Auto-commit dangling interaction
    endInteraction();
  }
  interaction = {
    label,
    preMetaSnapshot: pre,
    debounceTimer: null,
  };
}

function tickInteraction(): void {
  if (!interaction) return;
  // Reset the auto-commit timer
  if (interaction.debounceTimer) {
    clearTimeout(interaction.debounceTimer);
  }
  interaction.debounceTimer = setTimeout(() => {
    endInteraction();
  }, DEBOUNCE_MS);
}

function endInteraction(): void {
  if (!interaction) return;
  if (interaction.debounceTimer) clearTimeout(interaction.debounceTimer);
  const post = captureState();
  if (!post) { interaction = null; return; }
  const pre = interaction.preMetaSnapshot;
  if (statesChanged(pre, post)) {
    history.push(post);
    markDirty();
  }
  interaction = null;
}

// ─── Discrete actions (toggle visibility, reorder, etc.) ────────────

/**
 * Record a discrete mutation and immediately push a snapshot to history.
 *
 * Use this for one-shot actions (e.g. revert, layer reorder, visibility toggle)
 * that should each produce a distinct undo entry without debouncing.
 *
 * Skips the history push when the action produces no observable state change
 * (e.g. a drag-stop with zero displacement), avoiding useless undo entries.
 */
function recordSnapshot<T>(_label: string, fn: () => T): T {
  if (!store) {
    return fn(); // not initialized — action runs but no history entry
  }
  const pre = captureState();
  const result = fn();
  const post = captureState();
  if (pre && post && statesChanged(pre, post)) {
    history.push(post);
    markDirty();
  }
  return result;
}

// ─── Undo / redo ────────────────────────────────────────────────────
//
// Two stacks compose here: the backend's snapshot-based history (canonical
// adjustments, widgets, masks, image-node transforms) and the frontend's
// workspace-layout history (image-node positions, tether edges, widget
// node placement). Undo/redo tries the BACKEND first — slider commits and
// widget lifecycle are far more frequent than workspace ops — then falls
// back to the frontend stack when the backend has nothing.

async function undoAction(): Promise<void> {
  if (interaction) endInteraction();
  const sessionId = useBackendState.getState().sessionId;
  logWidgetUndoDiag('undo:start', { hasSession: !!sessionId });
  if (sessionId) {
    try {
      const applied = await backendTools.undo(sessionId);
      if (applied !== null) {
        logWidgetUndoDiag('undo:handled-by-backend', { applied });
        return;  // backend handled it
      }
      logWidgetUndoDiag('undo:backend-returned-null-falling-back');
    } catch (err) {
      console.warn('[history] backend undo failed, falling back:', err);
    }
  }
  const snap = history.undo<SerializableState>();
  if (snap) restoreState(snap);
  logWidgetUndoDiag('undo:frontend-fallback-applied', { hadSnap: !!snap });
}

async function redoAction(): Promise<void> {
  if (interaction) endInteraction();
  const sessionId = useBackendState.getState().sessionId;
  if (sessionId) {
    try {
      const applied = await backendTools.redo(sessionId);
      if (applied !== null) return;
    } catch (err) {
      console.warn('[history] backend redo failed, falling back:', err);
    }
  }
  const snap = history.redo<SerializableState>();
  if (snap) restoreState(snap);
}

// ─── Workspace mutations (each pushes a history entry) ──────────────

/**
 * Wrappers that route discrete workspace mutations through `recordSnapshot`
 * so each user-driven graph edit becomes a distinct undo step.
 *
 * NOT wrapped (intentional):
 * - The auto-mount `addImageNode` in `CanvasWorkspace` (initialization).
 * - Per-frame drag updates — only call wrappers on `onNodeDragStop`.
 *
 * SSE-driven placements (`workspace-tether.ts`) ARE wrapped, via `batch`:
 * the user expects undo to be able to roll back a backend-placed widget to
 * the pre-placement state. `batch` consolidates multiple slice mutations
 * (e.g. position + edge) into a single history entry.
 */
const workspace = {
  addImageNode(layerIds: string[], position?: Point): string | undefined {
    return recordSnapshot('Add image node', () =>
      useEditorStore.getState().addImageNode(layerIds, position),
    );
  },

  splitImageNode(sourceId: string, layerIdToSplit: string): string | null {
    return recordSnapshot(
      'Split image node',
      () => useEditorStore.getState().splitImageNode(sourceId, layerIdToSplit) ?? null,
    );
  },

  /**
   * Peel the currently active layer off `sourceNodeId` onto a new ImageNode.
   * Guards: source node exists, an active layer is set, the layer actually
   * belongs to the source, and the source has more than one layer.
   *
   * Wraps the slice action in a history snapshot so the user can undo the split.
   */
  splitActiveLayer(sourceNodeId: string): void {
    const state = useEditorStore.getState();
    const node = state.imageNodes[sourceNodeId];
    const activeLayerId = state.activeLayerId;
    if (!node || !activeLayerId) return;
    if (!node.layerIds.includes(activeLayerId)) return;
    if (node.layerIds.length < 2) return;
    recordSnapshot('Split active layer', () => {
      useEditorStore.getState().splitImageNode(sourceNodeId, activeLayerId);
    });
  },

  mergeImageNodes(sourceId: string, targetId: string): void {
    recordSnapshot('Merge image nodes', () =>
      useEditorStore.getState().mergeImageNodes(sourceId, targetId),
    );
  },

  /**
   * Fold `sourceNodeId` into `targetNodeId`. Thin wrapper over `mergeImageNodes`
   * with arg order matching "merge SOURCE into TARGET" (target first), guarding
   * against missing nodes and self-merge.
   */
  mergeInto(targetNodeId: string, sourceNodeId: string): void {
    const state = useEditorStore.getState();
    if (!state.imageNodes[targetNodeId] || !state.imageNodes[sourceNodeId]) return;
    if (targetNodeId === sourceNodeId) return;
    recordSnapshot('Merge into image node', () => {
      useEditorStore.getState().mergeImageNodes(sourceNodeId, targetNodeId);
    });
  },

  removeImageNode(id: string): void {
    recordSnapshot('Remove image node', () =>
      useEditorStore.getState().removeImageNode(id),
    );
    // Free the node's cached internal + per-layer scratch canvases (full-res,
    // tens of MB at 4K). Only closeDocument() cleared these before, so
    // extract/delete cycles leaked a detached canvas set per removed node.
    clearInternalCanvasCache(id);
  },

  /** Merge an image node's visible layers into one flat raster layer
   *  ("Merge Visible"). One undo step; no-op (with toast) when <2 visible. */
  mergeVisibleLayers(imageNodeId: string): void {
    recordSnapshot('Merge visible layers', () => mergeVisibleLayersBody(imageNodeId));
  },

  /** Delete a single layer through the facade so it's undoable. Catches the
   *  "layer has children" throw (leaves the layer in place). */
  removeLayer(id: string): void {
    recordSnapshot('Delete layer', () => {
      try {
        useEditorStore.getState().removeLayer(id);
      } catch {
        /* layer has children — remove children first. */
      }
    });
  },

  /**
   * User-facing "Delete" on an image node. Behaves as:
   *  - last image node in the document → `closeDocument()` (legacy behaviour,
   *    the document is meaningless without an image).
   *  - any secondary node (e.g. one produced by "Extract to Image Node") →
   *    drop the node + the layers it exclusively owned. Layers shared with
   *    other nodes are left alone. Pixel data is cleaned up by the layer-
   *    lifecycle hook when the orphaned layers are removed.
   */
  deleteImageNode(id: string): void {
    const state = useEditorStore.getState();
    const node = state.imageNodes[id];
    if (!node) return;
    const allNodes = Object.values(state.imageNodes);
    if (allNodes.length <= 1) {
      closeDocument();
      return;
    }
    const exclusiveLayers = node.layerIds.filter((lid) =>
      !allNodes.some((n) => n.id !== id && n.layerIds.includes(lid)),
    );
    recordSnapshot('Delete image node', () => {
      const s = useEditorStore.getState();
      s.removeImageNode(id);
      for (const lid of exclusiveLayers) {
        try { s.removeLayer(lid); } catch { /* layer with children: skip */ }
      }
    });
    clearInternalCanvasCache(id); // free the node's cached render canvases
  },

  setEdge(edge: TetherEdgeState): void {
    recordSnapshot('Bind tether', () => useEditorStore.getState().setEdge(edge));
  },

  unbindEdge(edgeId: string): void {
    recordSnapshot('Unbind tether', () => useEditorStore.getState().unbindEdge(edgeId));
  },

  setNodePosition(id: string, position: Point): void {
    recordSnapshot('Move image node', () =>
      useEditorStore.getState().setNodePosition(id, position),
    );
  },

  setWidgetPosition(id: string, position: Point): void {
    recordSnapshot('Move widget', () =>
      useEditorStore.getState().setWidgetPosition(id, position),
    );
  },

  setLayerNodePosition(id: string, position: Point): void {
    recordSnapshot('Move layers node', () =>
      useEditorStore.getState().setLayerNodePosition(id, position),
    );
  },

  // ─── Info widgets (frontend-only — undo/redo via SerializableState) ──
  addInfoNode(
    content: InfoNodeContent,
    options?: { position?: Point; size?: Size; title?: string; targetImageNodeId?: string },
  ): string | undefined {
    return recordSnapshot('Pin info widget', () =>
      useEditorStore.getState().addInfoNode(content, options),
    );
  },

  setInfoNodePosition(id: string, position: Point): void {
    recordSnapshot('Move info widget', () =>
      useEditorStore.getState().setInfoNodePosition(id, position),
    );
  },

  updateInfoNode(
    id: string,
    patch: Partial<Pick<InfoNodeState, 'content' | 'title' | 'size'>>,
  ): void {
    recordSnapshot('Update info widget', () =>
      useEditorStore.getState().updateInfoNode(id, patch),
    );
  },

  removeInfoNode(id: string): void {
    recordSnapshot('Remove info widget', () =>
      useEditorStore.getState().removeInfoNode(id),
    );
  },

  /**
   * Wrap several slice mutations in a single history snapshot.
   *
   * Use when one logical action involves multiple slice calls (e.g. SSE
   * widget placement = setWidgetPosition + setEdge) and you want them to
   * appear as a single undo step.
   */
  batch(label: string, fn: () => void): void {
    recordSnapshot(label, fn);
  },
};

// ─── Public API ─────────────────────────────────────────────────────

export const editorDocument = {
  // Lifecycle
  init,
  dispose,
  newDocument,
  closeDocument,
  openImage,
  addImage,

  // Interactions (slider debouncing)
  beginInteraction,
  tickInteraction,
  endInteraction,
  get hasActiveInteraction() {
    return interaction !== null;
  },

  // Discrete actions
  recordSnapshot,

  // Workspace mutations (each produces a history entry)
  workspace,

  // Undo / redo
  undo: undoAction,
  redo: redoAction,

  // State (single source of truth: Zustand store)
  get isDirty() {
    return store?.getState().isDirty ?? false;
  },
  get meta() {
    return store?.getState().documentMeta ?? null;
  },
  get pixelStore() {
    return pixelStore;
  },
  get history() {
    return history;
  },
  get historyStore() {
    return history.historyStore;
  },
};
