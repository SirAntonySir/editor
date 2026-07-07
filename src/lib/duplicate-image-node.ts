/**
 * Deep image-node Duplicate — the Cmd+D / "Duplicate" entry point.
 *
 * Replicates a WHOLE image node into a sibling beside it:
 *  1. every layer duplicated (pixels + metadata) with fresh ids — done on the
 *     frontend via `duplicateLayer`;
 *  2. every layer's adjustments + tethered widgets cloned onto the new layer
 *     ids — done on the BACKEND via `duplicate_layer_edits` (the operation graph
 *     and widgets are backend-owned; see Engine SSoT doctrine).
 *
 * The backend call is fire-and-forget: the structural duplicate (all layers
 * with copied pixels) is visible immediately; the adjustments/widgets reconcile
 * when the snapshot returns. If the backend is offline the duplicate still
 * lands, just without the live edits carried over.
 */
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { duplicateLayer } from '@/store/segment-actions';
import { UI } from '@/config';
import { toast } from '@/components/ui/Toast';

/** Deep-duplicate one image node. Returns the new node id, or null on failure.
 *  Not history-wrapped itself — callers wrap in `editorDocument.workspace.batch`
 *  so the whole duplicate is one undo step. `offset` places the copy at
 *  `source + offset` (used by group duplicate to keep a cluster's shape);
 *  omitted, the copy lands just right of the source (single Cmd+D). */
export function duplicateImageNode(id: string, offset?: { x: number; y: number }): string | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[id];
  if (!node || node.layerIds.length === 0) {
    toast.info('No image selected to duplicate.');
    return null;
  }

  // 1. Duplicate every layer (pixels + metadata), building the id mapping the
  //    backend needs to clone the per-layer operation-graph nodes + widgets.
  const mapping: Array<{ fromLayerId: string; toLayerId: string }> = [];
  for (const layerId of node.layerIds) {
    const newLayerId = duplicateLayer(layerId);
    if (!newLayerId) continue; // skip a layer whose pixels couldn't be copied
    mapping.push({ fromLayerId: layerId, toLayerId: newLayerId });
  }
  if (mapping.length === 0) {
    toast.error('Image data unavailable. Try reloading the document.');
    return null;
  }

  // 2. Place the duplicated layers on a new node. Uniform offset for group
  //    duplicates (keeps the cluster shape); just right of the source otherwise.
  const position = offset
    ? { x: node.position.x + offset.x, y: node.position.y + offset.y }
    : { x: node.position.x + node.size.w + UI.splitGapPx, y: node.position.y };
  const newNodeId = editor.addImageNode(
    mapping.map((m) => m.toLayerId),
    position,
    node.sourceSize,
  );
  editor.setImageNodeName(newNodeId, deriveDuplicateName(node.name ?? 'Image'));

  // 3. Carry adjustments + widgets onto the new layers (backend-owned).
  const sessionId = useBackendState.getState().sessionId;
  const offline = useBackendState.getState().sseStatus !== 'open';
  if (sessionId && !offline) {
    void backendTools.duplicate_layer_edits(sessionId, { mapping });
  }
  return newNodeId;
}

/** Duplicate the currently-active image node. No-op + toast when there isn't
 *  one. Returns the new node's id, or null on failure. */
export function duplicateActiveImageNode(): string | null {
  const id = useEditorStore.getState().activeImageNodeId;
  if (!id) {
    toast.info('No image selected to duplicate.');
    return null;
  }
  return duplicateImageNode(id);
}

/** Append " copy" before the extension. `foo.jpg` → `foo copy.jpg`,
 *  `foo copy.jpg` → `foo copy 2.jpg`, etc. */
export function deriveDuplicateName(name: string): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  const copyMatch = stem.match(/ copy(?: (\d+))?$/);
  if (!copyMatch) return `${stem} copy${ext}`;
  const n = copyMatch[1] ? parseInt(copyMatch[1], 10) : 1;
  const root = stem.slice(0, stem.length - copyMatch[0].length);
  return `${root} copy ${n + 1}${ext}`;
}
