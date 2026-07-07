import { useEditorStore } from '@/store';
import { duplicateImageNode } from './duplicate-image-node';
import { UI } from '@/config';

/**
 * Duplicate a multi-node canvas selection (the group / Cmd+D-with-N-selected
 * case). Deep-duplicates each selected image node and clones each selected info
 * node, offsetting the whole set by a single uniform delta so the cluster keeps
 * its shape.
 *
 * Widget tethers to duplicated image nodes regenerate from the backend clone
 * (`duplicate_layer_edits` inside `duplicateImageNode`) + `syncWidgetTethers`,
 * so they don't need manual recreation here. Info→image tethers are repointed
 * to the duplicate when that image node was ALSO in the selection; otherwise the
 * clone keeps pointing at the original (a cross-selection reference).
 *
 * Returns the new node ids. Not history-wrapped itself — the caller wraps it in
 * one `editorDocument.workspace.batch` so the group duplicate is a single undo.
 */
const GROUP_OFFSET = { x: UI.splitGapPx, y: UI.splitGapPx };

export function duplicateSelection(selectedIds: string[]): string[] {
  const store = useEditorStore.getState();
  const newIds: string[] = [];
  // source image-node id → its duplicate, so co-selected info nodes repoint.
  const imageMap = new Map<string, string>();

  for (const id of selectedIds) {
    if (!store.imageNodes[id]) continue;
    const dup = duplicateImageNode(id, GROUP_OFFSET);
    if (dup) {
      imageMap.set(id, dup);
      newIds.push(dup);
    }
  }

  for (const id of selectedIds) {
    const info = useEditorStore.getState().infoNodes[id];
    if (!info) continue;
    const retarget = info.targetImageNodeId ? imageMap.get(info.targetImageNodeId) : undefined;
    const dup = useEditorStore.getState().duplicateInfoNode(id, retarget);
    if (dup) newIds.push(dup);
  }

  return newIds;
}
