/**
 * Pure tree-structured history. No DOM, no Zustand. Operations take state
 * in and return new state (the public store wraps this in a mutable ref).
 */
import type { HistoryNode, HistoryTreeSnapshot, SerializableState } from './types';

export interface HistoryTree {
  nodes: Map<string, HistoryNode>;
  rootId: string;
  currentNodeId: string;
  /** Name of the branch the user is currently extending. */
  currentBranch: string;
  branchHeads: Map<string, string>;
}

function newId(): string {
  return crypto.randomUUID();
}

export function createTree(initialState: SerializableState): HistoryTree {
  const rootId = newId();
  const root: HistoryNode = {
    id: rootId,
    parentId: null,
    childIds: [],
    label: 'Initial',
    timestamp: Date.now(),
    kind: 'root',
    metaSnapshot: initialState,
    estimatedSize: 4096,
  };
  return {
    nodes: new Map([[rootId, root]]),
    rootId,
    currentNodeId: rootId,
    currentBranch: 'main',
    branchHeads: new Map([['main', rootId]]),
  };
}

export function canUndo(tree: HistoryTree): boolean {
  return tree.nodes.get(tree.currentNodeId)?.parentId != null;
}

export function canRedo(tree: HistoryTree): boolean {
  const node = tree.nodes.get(tree.currentNodeId);
  return !!node && node.childIds.length > 0;
}

/**
 * Append a new node as a child of `currentNodeId`. The new node becomes the
 * current pointer. If the current node already has children (i.e. user undid
 * and is now branching), the new node is appended as an *additional* child;
 * the previous branch remains reachable.
 */
export function append(
  tree: HistoryTree,
  entry: Omit<HistoryNode, 'id' | 'parentId' | 'childIds'>,
): HistoryTree {
  const parentId = tree.currentNodeId;
  const parent = tree.nodes.get(parentId);
  if (!parent) throw new Error(`append: unknown parent ${parentId}`);

  const id = newId();
  const node: HistoryNode = {
    ...entry,
    id,
    parentId,
    childIds: [],
  };

  const nodes = new Map(tree.nodes);
  nodes.set(id, node);
  nodes.set(parentId, { ...parent, childIds: [...parent.childIds, id] });

  // Only advance the currently-active branch head if it's colocated at the
  // parent. Other branch heads sitting at the same parent (e.g. just after
  // branchFrom) remain pinned to the shared parent until their branch is
  // explicitly extended.
  const branchHeads = new Map(tree.branchHeads);
  const activeHead = branchHeads.get(tree.currentBranch);
  if (activeHead === parentId) {
    branchHeads.set(tree.currentBranch, id);
  }

  return { ...tree, nodes, currentNodeId: id, branchHeads };
}

export function undo(tree: HistoryTree): HistoryTree {
  const node = tree.nodes.get(tree.currentNodeId);
  if (!node || node.parentId == null) return tree;
  return { ...tree, currentNodeId: node.parentId };
}

/**
 * Redo follows the most-recently-created child. This matches flat undo/redo
 * intuition: the child appended last is the one redo restores.
 */
export function redo(tree: HistoryTree): HistoryTree {
  const node = tree.nodes.get(tree.currentNodeId);
  if (!node || node.childIds.length === 0) return tree;
  const nextId = node.childIds[node.childIds.length - 1];
  return { ...tree, currentNodeId: nextId };
}

export function branchFrom(
  tree: HistoryTree,
  nodeId: string,
  name: string,
): HistoryTree {
  if (!tree.nodes.has(nodeId)) throw new Error(`branchFrom: unknown node ${nodeId}`);
  if (tree.branchHeads.has(name)) {
    throw new Error(`branchFrom: branch "${name}" already exists`);
  }
  const branchHeads = new Map(tree.branchHeads);
  branchHeads.set(name, nodeId);
  return { ...tree, currentNodeId: nodeId, currentBranch: name, branchHeads };
}

export function switchBranch(tree: HistoryTree, name: string): HistoryTree {
  const head = tree.branchHeads.get(name);
  if (head == null) throw new Error(`switchBranch: unknown branch ${name}`);
  return { ...tree, currentNodeId: head, currentBranch: name };
}

export function setMilestone(
  tree: HistoryTree,
  nodeId: string,
  label: string,
): HistoryTree {
  const node = tree.nodes.get(nodeId);
  if (!node) throw new Error(`setMilestone: unknown node ${nodeId}`);
  const nodes = new Map(tree.nodes);
  nodes.set(nodeId, { ...node, milestoneLabel: label });
  return { ...tree, nodes };
}

/**
 * Returns the linear path from root to current node (inclusive). Used by
 * HistoryPanel to render a flat list while the tree-aware UI is unbuilt.
 */
export function getCurrentPath(tree: HistoryTree): HistoryNode[] {
  const path: HistoryNode[] = [];
  let cursor: string | null = tree.currentNodeId;
  while (cursor) {
    const node = tree.nodes.get(cursor);
    if (!node) break;
    path.unshift(node);
    cursor = node.parentId;
  }
  return path;
}

export interface EvictionBudget {
  maxEntries: number;
  maxBytes: number;
}

/**
 * Evict oldest non-current, non-milestone, non-branch-head nodes until both
 * budgets are respected. Removing an interior node relinks its children to
 * its parent so the tree stays connected. The root is anchored — it is never
 * removed, but it can be re-pointed to a descendant if all earlier nodes
 * have been collapsed.
 */
export function evict(tree: HistoryTree, budget: EvictionBudget): HistoryTree {
  const pinned = new Set<string>();
  pinned.add(tree.currentNodeId);
  pinned.add(tree.rootId);
  for (const head of tree.branchHeads.values()) pinned.add(head);
  for (const node of tree.nodes.values()) {
    if (node.milestoneLabel) pinned.add(node.id);
  }

  let totalBytes = 0;
  for (const node of tree.nodes.values()) totalBytes += node.estimatedSize;

  // Sort eviction candidates by timestamp ascending (oldest first).
  const candidates = Array.from(tree.nodes.values())
    .filter((n) => !pinned.has(n.id))
    .sort((a, b) => a.timestamp - b.timestamp);

  const nodes = new Map(tree.nodes);
  let removed = 0;

  for (const victim of candidates) {
    if (nodes.size <= budget.maxEntries && totalBytes <= budget.maxBytes) break;
    // Relink: each child of victim now points at victim.parent
    const v = nodes.get(victim.id);
    if (!v || v.parentId == null) continue;
    const parent = nodes.get(v.parentId);
    if (!parent) continue;
    const parentChildren = parent.childIds.filter((c) => c !== victim.id);
    for (const childId of v.childIds) {
      const child = nodes.get(childId);
      if (child) nodes.set(childId, { ...child, parentId: v.parentId });
      parentChildren.push(childId);
    }
    nodes.set(v.parentId, { ...parent, childIds: parentChildren });
    nodes.delete(victim.id);
    totalBytes -= victim.estimatedSize;
    removed++;
  }

  if (removed === 0) return tree;
  return { ...tree, nodes };
}

export function toSnapshot(tree: HistoryTree): HistoryTreeSnapshot {
  const nodes: HistoryTreeSnapshot['nodes'] = {};
  for (const [id, node] of tree.nodes) {
    const { prePixels, postPixels, ...rest } = node;
    nodes[id] = {
      ...rest,
      prePixelLayerIds: prePixels ? Array.from(prePixels.keys()) : undefined,
      postPixelLayerIds: postPixels ? Array.from(postPixels.keys()) : undefined,
    };
  }
  return {
    nodes,
    rootId: tree.rootId,
    currentNodeId: tree.currentNodeId,
    currentBranch: tree.currentBranch,
    branchHeads: Object.fromEntries(tree.branchHeads),
  };
}

/**
 * Rebuild a HistoryTree from a serialised snapshot. `pixelBlobs` is a flat
 * map of `${nodeId}:${pre|post}:${layerId}` → Blob; callers (serializer /
 * session-storage) provide it after reading pixel data from disk / IndexedDB.
 */
export function fromSnapshot(
  snapshot: HistoryTreeSnapshot,
  pixelBlobs: Map<string, Blob>,
): HistoryTree {
  const nodes = new Map<string, HistoryNode>();
  for (const [id, raw] of Object.entries(snapshot.nodes)) {
    const { prePixelLayerIds, postPixelLayerIds, ...rest } = raw;
    const lookup = (layerIds: string[] | undefined, kind: 'pre' | 'post') => {
      if (!layerIds || layerIds.length === 0) return undefined;
      const m = new Map<string, Blob>();
      for (const layerId of layerIds) {
        const blob = pixelBlobs.get(`${id}:${kind}:${layerId}`);
        if (blob) m.set(layerId, blob);
      }
      return m.size > 0 ? m : undefined;
    };
    nodes.set(id, {
      ...rest,
      prePixels: lookup(prePixelLayerIds, 'pre'),
      postPixels: lookup(postPixelLayerIds, 'post'),
    });
  }
  return {
    nodes,
    rootId: snapshot.rootId,
    currentNodeId: snapshot.currentNodeId,
    // Defensive default — v2 snapshots always have this; v1 migrations fill it
    // before reaching this code path.
    currentBranch: snapshot.currentBranch ?? 'main',
    branchHeads: new Map(Object.entries(snapshot.branchHeads)),
  };
}
