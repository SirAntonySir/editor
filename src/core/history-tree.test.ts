import { describe, it, expect } from 'vitest';
import type { SerializableState } from './types';
import {
  createTree,
  append,
  undo,
  redo,
  branchFrom,
  switchBranch,
  setMilestone,
  getCurrentPath,
  canUndo,
  canRedo,
  evict,
  toSnapshot,
  fromSnapshot,
} from './history-tree';

function snap(activeLayerId: string | null = null): SerializableState {
  return { layers: [], activeLayerId, pixelVersion: 0, graphPositions: {} };
}

describe('createTree', () => {
  it('starts with a root node and main branch', () => {
    const tree = createTree(snap('a'));
    expect(tree.rootId).toBeTruthy();
    expect(tree.currentNodeId).toBe(tree.rootId);
    expect(Array.from(tree.nodes.keys())).toHaveLength(1);
    expect(tree.nodes.get(tree.rootId)!.kind).toBe('root');
    expect(tree.nodes.get(tree.rootId)!.metaSnapshot.activeLayerId).toBe('a');
    expect(tree.branchHeads.get('main')).toBe(tree.rootId);
  });
});

describe('append / undo / redo on a linear path', () => {
  it('appends a child, advances currentNodeId, updates main head', () => {
    let tree = createTree(snap('a'));
    tree = append(tree, {
      label: 'Set exposure',
      timestamp: 1,
      kind: 'metadata',
      metaSnapshot: snap('a'),
      estimatedSize: 1024,
    });
    const root = tree.rootId;
    const child = tree.currentNodeId;
    expect(child).not.toBe(root);
    expect(tree.nodes.get(root)!.childIds).toEqual([child]);
    expect(tree.nodes.get(child)!.parentId).toBe(root);
    expect(tree.branchHeads.get('main')).toBe(child);
    expect(canUndo(tree)).toBe(true);
    expect(canRedo(tree)).toBe(false);
  });

  it('undo moves currentNodeId to parent without dropping the child node', () => {
    let tree = createTree(snap('a'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('a'), estimatedSize: 1024 });
    const childId = tree.currentNodeId;
    tree = undo(tree);
    expect(tree.currentNodeId).toBe(tree.rootId);
    expect(tree.nodes.has(childId)).toBe(true);
    expect(canUndo(tree)).toBe(false);
    expect(canRedo(tree)).toBe(true);
  });

  it('redo moves currentNodeId back to the last-visited child', () => {
    let tree = createTree(snap('a'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('a'), estimatedSize: 1024 });
    const childId = tree.currentNodeId;
    tree = undo(tree);
    tree = redo(tree);
    expect(tree.currentNodeId).toBe(childId);
  });

  it('appending after undo creates a sibling branch under the parent', () => {
    let tree = createTree(snap('a'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('a'), estimatedSize: 1024 });
    const firstChild = tree.currentNodeId;
    tree = undo(tree);
    tree = append(tree, { label: 'B', timestamp: 2, kind: 'metadata', metaSnapshot: snap('b'), estimatedSize: 1024 });
    const root = tree.nodes.get(tree.rootId)!;
    expect(root.childIds).toHaveLength(2);
    expect(root.childIds).toContain(firstChild);
    expect(root.childIds).toContain(tree.currentNodeId);
  });
});

describe('branchFrom + switchBranch', () => {
  it('spec exit criterion: commit → branch → switch → commit → switch back → undo', () => {
    let tree = createTree(snap('initial'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('A'), estimatedSize: 100 });
    const a = tree.currentNodeId;

    tree = branchFrom(tree, a, 'experiment');
    expect(tree.branchHeads.get('experiment')).toBe(a);
    expect(tree.currentNodeId).toBe(a);

    tree = append(tree, { label: 'B', timestamp: 2, kind: 'metadata', metaSnapshot: snap('B'), estimatedSize: 100 });
    const b = tree.currentNodeId;
    expect(tree.branchHeads.get('experiment')).toBe(b);
    expect(tree.branchHeads.get('main')).toBe(a);

    tree = switchBranch(tree, 'main');
    expect(tree.currentNodeId).toBe(a);

    tree = append(tree, { label: 'C', timestamp: 3, kind: 'metadata', metaSnapshot: snap('C'), estimatedSize: 100 });
    const c = tree.currentNodeId;
    expect(tree.branchHeads.get('main')).toBe(c);
    expect(tree.branchHeads.get('experiment')).toBe(b);

    tree = undo(tree);
    expect(tree.currentNodeId).toBe(a);

    tree = switchBranch(tree, 'experiment');
    expect(tree.currentNodeId).toBe(b);
  });
});

describe('setMilestone', () => {
  it('attaches a label to a node', () => {
    let tree = createTree(snap());
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    const a = tree.currentNodeId;
    tree = setMilestone(tree, a, 'first cut');
    expect(tree.nodes.get(a)!.milestoneLabel).toBe('first cut');
  });
});

describe('evict', () => {
  function withBudget(maxEntries: number, maxBytes: number) {
    return { maxEntries, maxBytes };
  }

  it('keeps the tree intact when under both budgets', () => {
    let tree = createTree(snap());
    for (let i = 0; i < 5; i++) {
      tree = append(tree, { label: `n${i}`, timestamp: i, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    }
    const before = tree.nodes.size;
    tree = evict(tree, withBudget(50, 1_000_000));
    expect(tree.nodes.size).toBe(before);
  });

  it('evicts oldest non-current, non-milestone, non-branch-head nodes first', () => {
    let tree = createTree(snap());
    // Build a 4-node main chain
    for (let i = 0; i < 4; i++) {
      tree = append(tree, { label: `n${i}`, timestamp: i, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    }
    // maxEntries = 2 → must evict 3 of the 5 nodes (root + 4); only the root
    // (anchor) plus current + path to current can stay. Implementation
    // detail: we collapse evicted ancestor chains by relinking children to
    // grand-parents — root stays as anchor.
    tree = evict(tree, withBudget(2, 1_000_000));
    expect(tree.nodes.size).toBeLessThanOrEqual(3); // root + current + at most 1 ancestor
    expect(tree.nodes.has(tree.rootId)).toBe(true);
    expect(tree.nodes.has(tree.currentNodeId)).toBe(true);
  });

  it('preserves milestone nodes during eviction when budget allows', () => {
    let tree = createTree(snap());
    for (let i = 0; i < 6; i++) {
      tree = append(tree, { label: `n${i}`, timestamp: i, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    }
    // Mark the 2nd appended node as a milestone
    const path = getCurrentPath(tree);
    const milestoneId = path[2].id; // root, n0, n1 — pick n1
    tree = setMilestone(tree, milestoneId, 'keep me');

    // Tight entry budget that forces eviction but allows the milestone
    tree = evict(tree, withBudget(4, 1_000_000));
    expect(tree.nodes.has(milestoneId)).toBe(true);
    expect(tree.nodes.get(milestoneId)!.milestoneLabel).toBe('keep me');
  });

  it('respects branch heads when picking eviction candidates', () => {
    let tree = createTree(snap());
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    const a = tree.currentNodeId;
    tree = branchFrom(tree, a, 'side');
    tree = append(tree, { label: 'B', timestamp: 2, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    const b = tree.currentNodeId;
    tree = switchBranch(tree, 'main');
    for (let i = 0; i < 4; i++) {
      tree = append(tree, { label: `m${i}`, timestamp: 10 + i, kind: 'metadata', metaSnapshot: snap(), estimatedSize: 100 });
    }
    tree = evict(tree, withBudget(4, 1_000_000));
    // Branch head B must still be reachable.
    expect(tree.nodes.has(b)).toBe(true);
    expect(tree.branchHeads.get('side')).toBe(b);
  });
});

describe('snapshot round-trip', () => {
  it('round-trips structure, branches, current pointer, milestones', () => {
    let tree = createTree(snap('start'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('A'), estimatedSize: 100 });
    const a = tree.currentNodeId;
    tree = branchFrom(tree, a, 'exp');
    tree = append(tree, { label: 'B', timestamp: 2, kind: 'metadata', metaSnapshot: snap('B'), estimatedSize: 100 });
    tree = setMilestone(tree, a, 'milestone-a');

    const snapJson = toSnapshot(tree);
    const restored = fromSnapshot(snapJson, new Map());

    expect(restored.rootId).toBe(tree.rootId);
    expect(restored.currentNodeId).toBe(tree.currentNodeId);
    expect(restored.branchHeads.get('main')).toBe(tree.branchHeads.get('main'));
    expect(restored.branchHeads.get('exp')).toBe(tree.branchHeads.get('exp'));
    expect(restored.nodes.size).toBe(tree.nodes.size);
    expect(restored.nodes.get(a)!.milestoneLabel).toBe('milestone-a');
  });
});

describe('snapshot round-trip with pre/post pixels', () => {
  it('preserves pre/post pixel maps via the keyed blob lookup', () => {
    let t = createTree(snap());
    const preBlob = new Blob(['pre'], { type: 'image/png' });
    const postBlob = new Blob(['post'], { type: 'image/png' });
    t = append(t, {
      label: 'destructive op',
      timestamp: 1,
      kind: 'destructive',
      metaSnapshot: snap(),
      prePixels: new Map([['layer-1', preBlob]]),
      postPixels: new Map([['layer-1', postBlob]]),
      estimatedSize: preBlob.size + postBlob.size + 4096,
    });
    const nodeId = t.currentNodeId;
    const snapJson = toSnapshot(t);
    const blobs = new Map<string, Blob>([
      [`${nodeId}:pre:layer-1`, preBlob],
      [`${nodeId}:post:layer-1`, postBlob],
    ]);
    const restored = fromSnapshot(snapJson, blobs);
    expect(restored.nodes.get(nodeId)!.prePixels?.get('layer-1')).toBe(preBlob);
    expect(restored.nodes.get(nodeId)!.postPixels?.get('layer-1')).toBe(postBlob);
  });
});
