# Phase 2 — Tree-History Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat undo/redo stacks in `src/core/history.ts` with a tree-structured history that supports milestones, named branches, and branch switching. Phase-2 ships only the data layer + plumbing; the branching UI lands in Phase 5.

**Architecture:** A new pure module `src/core/history-tree.ts` owns the tree data structure and operations (no DOM, no Zustand, fully unit-testable). `src/core/history.ts` is rewritten on top of it, preserving the existing public surface (`push`, `undo`, `redo`, `clear`, `historyStore`) so most callers don't change. New API surface (`branchFrom`, `switchBranch`, `setMilestone`, `getCurrentPath`, `jumpTo`) is exposed but unused by UI yet. `.edp` manifest gains a v2 schema with the tree; the loader transparently upgrades v1 (flat) manifests to a linear `main` branch.

**Tech Stack:** Existing — TypeScript 5.9 strict, Zustand vanilla store, fflate (`.edp` ZIP), IndexedDB (session). New dev dep: **vitest** (node env) for the pure-TS unit tests the spec requires as an exit criterion.

**Spec reference:** [`docs/superpowers/specs/2026-05-11-thesis-prototype-implementation-design.md`](../specs/2026-05-11-thesis-prototype-implementation-design.md) §4 Phase 2.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/core/history-tree.ts` | Pure tree data structure + operations (no DOM / store deps) |
| `src/core/history-tree.test.ts` | Vitest unit suite for the tree |
| `src/core/serializer-migrate.ts` | v1 → v2 manifest upgrade helper |
| `src/core/serializer-migrate.test.ts` | Migration round-trip tests with fixtures |
| `tests/fixtures/edp-v1-empty.json` | Manifest fixture: empty doc, no layers, no history |
| `tests/fixtures/edp-v1-single-image.json` | Manifest fixture: one image layer + basic adjustment |
| `tests/fixtures/edp-v1-with-text.json` | Manifest fixture: image + text + crop |
| `vitest.config.ts` | Vitest config (node env, `src/**/*.test.ts`) |

### Modified

| Path | Change |
|---|---|
| `package.json` | Add `vitest` devDep + `test` / `test:run` scripts |
| `src/core/types.ts` | Add `HistoryNode`, `HistoryTreeSnapshot`, extend `HistoryEntry` |
| `src/core/history.ts` | Rewrite atop `history-tree`; preserve existing surface; add tree API |
| `src/core/document.ts` | Update undo/redo post-state swap to target the detached pointer node |
| `src/core/serializer.ts` | Manifest version bump → 2; persist tree; load v1/v2; thumbnail unchanged |
| `src/core/session-storage.ts` | Persist tree alongside layers; restore on session reload |
| `src/components/panels/HistoryPanel.tsx` | Read `getCurrentPath()` (linear path) — no UI rework |
| `tsconfig.app.json` | Exclude `**/*.test.ts` from the app build (let vitest own the tests) |
| `eslint.config.js` | Allow `*.test.ts` files; no rule changes |

---

## Pre-flight

- [ ] **P0a:** On `dev` branch:
  ```bash
  git branch --show-current
  ```
  Expected: `dev`.

- [ ] **P0b:** Working tree clean:
  ```bash
  git status --porcelain
  ```
  Expected: empty.

- [ ] **P0c:** Phase 1 baseline is green:
  ```bash
  npm run check
  ```
  Expected: exits 0. Fix any pre-existing errors before refactoring.

- [ ] **P0d:** Audit `editorDocument.history` and `historyStore` consumers so we know every call-site this refactor must keep working:
  ```bash
  grep -rEn 'editorDocument\.(undo|redo|history|historyStore)|historyStore\.' src --include='*.ts' --include='*.tsx'
  ```
  Expected callers (record any others surfaced): `keyboard-shortcuts.ts`, `MenuBar.tsx`, `HistoryPanel.tsx`, `CanvasContextMenu.tsx`. If new consumers appear, note them — the refactor must not break them.

---

## Task 1: Add vitest as a dev dependency

The spec exit criterion is a unit-level test demonstrating commit → branch → switch → commit → switch back → undo. The codebase has no JS test runner. Vitest is the lightest credible choice (zero-config, shares Vite config, node env runs without DOM).

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`, `tsconfig.app.json`, `eslint.config.js`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3
```

Expected: `package.json` gets `"vitest": "^3.x.x"` under `devDependencies`; `node_modules/vitest` exists.

- [ ] **Step 2: Add `vitest.config.ts`**

Write `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest",
"test:run": "vitest run"
```

And update `check`:

```json
"check": "tsc -b && eslint . && vitest run"
```

- [ ] **Step 4: Exclude test files from the app build**

Open `tsconfig.app.json` and add `"src/**/*.test.ts"` (and `"tests/**/*.ts"` if not already excluded) to the `exclude` array. If `exclude` doesn't exist, add:

```json
"exclude": ["src/**/*.test.ts", "tests/**/*.ts"]
```

- [ ] **Step 5: Sanity check vitest runs**

Create a throwaway `src/core/__vitest-sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
describe('vitest sanity', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

Run:
```bash
npx vitest run --reporter=verbose
```
Expected: 1 test passes.

Delete the sanity file:
```bash
rm src/core/__vitest-sanity.test.ts
```

- [ ] **Step 6: Confirm `npm run check` still green**

```bash
npm run check
```
Expected: exits 0 (no tests yet, vitest run will report "no test files found" or zero tests, both exit 0 with `--passWithNoTests` not needed in v3 default; if it fails on no-tests, append `--passWithNoTests` to the script).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tsconfig.app.json
git commit -m "chore: add vitest for unit testing the tree-history refactor"
```

---

## Task 2: Tree types

**Files:**
- Modify: `src/core/types.ts`

Define the wire types before writing code that uses them. These are the contract `history-tree.ts` and the serializer migration both lean on.

- [ ] **Step 1: Extend `src/core/types.ts`**

Append to the bottom of `src/core/types.ts`:

```ts
// ─── Tree-structured history ────────────────────────────────────────

/**
 * A node in the history tree. Each node captures the state AFTER its action
 * was applied (post-state). The root node represents the initial state of
 * the document (no action) and has `parentId: null`.
 */
export interface HistoryNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  label: string;
  timestamp: number;
  kind: 'metadata' | 'destructive' | 'root';
  /** Post-state metadata snapshot (state AFTER the action). */
  metaSnapshot: SerializableState;
  /** Pixel snapshots taken BEFORE the action (destructive only). */
  pixelSnapshots?: Map<string, Blob>;
  /** Optional user-facing milestone label (set via `setMilestone`). */
  milestoneLabel?: string;
  /** Estimated memory usage in bytes (used by eviction). */
  estimatedSize: number;
}

/**
 * Persistable snapshot of the entire history tree. Used by serializer +
 * session-storage. Blobs survive IndexedDB round-trips natively; for `.edp`
 * the serializer converts them to PNG entries under `history/<nodeId>/<layerId>.png`.
 */
export interface HistoryTreeSnapshot {
  /** Map of node ID → node (children stored by ID for cheap JSON). */
  nodes: Record<string, Omit<HistoryNode, 'pixelSnapshots'> & {
    /** Layer IDs that have a stored blob — actual Blob lives outside the JSON. */
    pixelLayerIds?: string[];
  }>;
  rootId: string;
  currentNodeId: string;
  /** Named branch heads. `main` always exists. */
  branchHeads: Record<string, string>;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -b
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(history): tree types — HistoryNode, HistoryTreeSnapshot"
```

---

## Task 3: Pure tree module — happy-path TDD

`src/core/history-tree.ts` is the heart of this phase. It is intentionally a pure data module — no Zustand store, no DOM, no Blob construction. Every operation takes the tree state in and returns the new state. This is what makes the spec's tree-correctness exit criterion testable.

**Files:**
- Create: `src/core/history-tree.ts`
- Create: `src/core/history-tree.test.ts`

### Step 1: Write the failing test for `createTree`

- [ ] Write `src/core/history-tree.test.ts`:

```ts
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
} from './history-tree';

function snap(activeLayerId: string | null = null): SerializableState {
  return { layers: [], activeLayerId, pixelVersion: 0, graphPositions: {} };
}

describe('createTree', () => {
  it('starts with a root node and main branch', () => {
    const tree = createTree(snap('a'));
    expect(tree.rootId).toBeTruthy();
    expect(tree.currentNodeId).toBe(tree.rootId);
    expect(tree.branchHeads.main).toBe(tree.rootId);
    expect(Object.keys(tree.nodes)).toHaveLength(1);
    expect(tree.nodes[tree.rootId].kind).toBe('root');
    expect(tree.nodes[tree.rootId].metaSnapshot.activeLayerId).toBe('a');
  });
});
```

### Step 2: Run — expect failure

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: fails — cannot resolve `./history-tree`.

### Step 3: Implement `createTree` minimally

- [ ] Write `src/core/history-tree.ts`:

```ts
/**
 * Pure tree-structured history. No DOM, no Zustand. Operations take state
 * in and return new state (the public store wraps this in a mutable ref).
 */
import type { HistoryNode, SerializableState } from './types';

export interface HistoryTree {
  nodes: Map<string, HistoryNode>;
  rootId: string;
  currentNodeId: string;
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
    branchHeads: new Map([['main', rootId]]),
  };
}

export function canUndo(_tree: HistoryTree): boolean { return false; }
export function canRedo(_tree: HistoryTree): boolean { return false; }
export function append(_tree: HistoryTree, _entry: Omit<HistoryNode, 'id' | 'parentId' | 'childIds'>): HistoryTree { throw new Error('not impl'); }
export function undo(_tree: HistoryTree): HistoryTree { throw new Error('not impl'); }
export function redo(_tree: HistoryTree): HistoryTree { throw new Error('not impl'); }
export function branchFrom(_tree: HistoryTree, _nodeId: string, _name: string): HistoryTree { throw new Error('not impl'); }
export function switchBranch(_tree: HistoryTree, _name: string): HistoryTree { throw new Error('not impl'); }
export function setMilestone(_tree: HistoryTree, _nodeId: string, _label: string): HistoryTree { throw new Error('not impl'); }
export function getCurrentPath(_tree: HistoryTree): HistoryNode[] { throw new Error('not impl'); }
```

> Note: the test imports use `tree.nodes[tree.rootId]` with object indexing; switch the test to `tree.nodes.get(tree.rootId)!` to match the `Map`-based shape. Update the test before re-running.

Update the assertions in the test:

```ts
    expect(Array.from(tree.nodes.keys())).toHaveLength(1);
    expect(tree.nodes.get(tree.rootId)!.kind).toBe('root');
    expect(tree.nodes.get(tree.rootId)!.metaSnapshot.activeLayerId).toBe('a');
    expect(tree.branchHeads.get('main')).toBe(tree.rootId);
```

### Step 4: Run — `createTree` test passes

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: 1 passed.

### Step 5: Write the failing test for `append` + `undo` + `redo`

- [ ] Append to `src/core/history-tree.test.ts`:

```ts
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
    expect(tree.nodes.has(childId)).toBe(true); // not garbage-collected
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
```

### Step 6: Run — expect failures

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: the four new tests fail with `not impl`.

### Step 7: Implement `append`, `undo`, `redo`, `canUndo`, `canRedo`

- [ ] Replace the stubbed functions in `src/core/history-tree.ts`:

```ts
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

  // Identify which branch we're on: any branch head pointing at the parent
  // gets advanced. If none does, this is an unnamed branch — only `currentNodeId`
  // moves. `main` is updated implicitly whenever we're on it.
  const branchHeads = new Map(tree.branchHeads);
  for (const [name, head] of branchHeads) {
    if (head === parentId) branchHeads.set(name, id);
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
```

### Step 8: Run — happy-path tests pass

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: 5 passed.

### Step 9: Failing test for `branchFrom` + `switchBranch` + `setMilestone`

- [ ] Append:

```ts
describe('branchFrom + switchBranch', () => {
  it('spec exit criterion: commit → branch → switch → commit → switch back → undo', () => {
    let tree = createTree(snap('initial'));
    tree = append(tree, { label: 'A', timestamp: 1, kind: 'metadata', metaSnapshot: snap('A'), estimatedSize: 100 });
    const a = tree.currentNodeId;

    // Branch from A
    tree = branchFrom(tree, a, 'experiment');
    expect(tree.branchHeads.get('experiment')).toBe(a);
    expect(tree.currentNodeId).toBe(a);

    // Commit on experiment
    tree = append(tree, { label: 'B', timestamp: 2, kind: 'metadata', metaSnapshot: snap('B'), estimatedSize: 100 });
    const b = tree.currentNodeId;
    expect(tree.branchHeads.get('experiment')).toBe(b);
    expect(tree.branchHeads.get('main')).toBe(a); // main untouched

    // Switch back to main
    tree = switchBranch(tree, 'main');
    expect(tree.currentNodeId).toBe(a);

    // Commit on main
    tree = append(tree, { label: 'C', timestamp: 3, kind: 'metadata', metaSnapshot: snap('C'), estimatedSize: 100 });
    const c = tree.currentNodeId;
    expect(tree.branchHeads.get('main')).toBe(c);
    expect(tree.branchHeads.get('experiment')).toBe(b); // preserved

    // Undo on main → back to A
    tree = undo(tree);
    expect(tree.currentNodeId).toBe(a);

    // Switch to experiment → at B
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
```

### Step 10: Implement `branchFrom`, `switchBranch`, `setMilestone`, `getCurrentPath`

- [ ] Replace stubs in `src/core/history-tree.ts`:

```ts
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
  return { ...tree, currentNodeId: nodeId, branchHeads };
}

export function switchBranch(tree: HistoryTree, name: string): HistoryTree {
  const head = tree.branchHeads.get(name);
  if (head == null) throw new Error(`switchBranch: unknown branch ${name}`);
  return { ...tree, currentNodeId: head };
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
```

### Step 11: Run — branch + milestone tests pass

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: 7 passed.

### Step 12: Failing test for eviction

- [ ] Append:

```ts
import { evict } from './history-tree';

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
```

### Step 13: Implement `evict`

- [ ] Append to `src/core/history-tree.ts`:

```ts
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

  // Also pin the entire ancestor chain of currentNodeId — we don't want to
  // collapse history the user is actively pointing into.
  let cursor: string | null = tree.currentNodeId;
  while (cursor) {
    pinned.add(cursor);
    const n: HistoryNode | undefined = tree.nodes.get(cursor);
    cursor = n?.parentId ?? null;
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
```

### Step 14: Run — all tree tests pass

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: 11 passed.

### Step 15: Add snapshot/restore for persistence

- [ ] Append to `src/core/history-tree.test.ts`:

```ts
import { toSnapshot, fromSnapshot } from './history-tree';

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
```

- [ ] Append to `src/core/history-tree.ts`:

```ts
import type { HistoryTreeSnapshot } from './types';

export function toSnapshot(tree: HistoryTree): HistoryTreeSnapshot {
  const nodes: HistoryTreeSnapshot['nodes'] = {};
  for (const [id, node] of tree.nodes) {
    const { pixelSnapshots, ...rest } = node;
    nodes[id] = {
      ...rest,
      pixelLayerIds: pixelSnapshots ? Array.from(pixelSnapshots.keys()) : undefined,
    };
  }
  return {
    nodes,
    rootId: tree.rootId,
    currentNodeId: tree.currentNodeId,
    branchHeads: Object.fromEntries(tree.branchHeads),
  };
}

/**
 * Rebuild a HistoryTree from a serialised snapshot. `pixelBlobs` is a flat
 * map of `${nodeId}:${layerId}` → Blob; callers (serializer / session-storage)
 * provide it after reading pixel data from disk / IndexedDB.
 */
export function fromSnapshot(
  snapshot: HistoryTreeSnapshot,
  pixelBlobs: Map<string, Blob>,
): HistoryTree {
  const nodes = new Map<string, HistoryNode>();
  for (const [id, raw] of Object.entries(snapshot.nodes)) {
    const { pixelLayerIds, ...rest } = raw;
    let pixelSnapshots: Map<string, Blob> | undefined;
    if (pixelLayerIds && pixelLayerIds.length > 0) {
      pixelSnapshots = new Map();
      for (const layerId of pixelLayerIds) {
        const blob = pixelBlobs.get(`${id}:${layerId}`);
        if (blob) pixelSnapshots.set(layerId, blob);
      }
      if (pixelSnapshots.size === 0) pixelSnapshots = undefined;
    }
    nodes.set(id, { ...rest, pixelSnapshots });
  }
  return {
    nodes,
    rootId: snapshot.rootId,
    currentNodeId: snapshot.currentNodeId,
    branchHeads: new Map(Object.entries(snapshot.branchHeads)),
  };
}
```

### Step 16: Run — full suite passes

- [ ] Run:
```bash
npx vitest run src/core/history-tree.test.ts
```
Expected: 12 passed.

### Step 17: Commit

- [ ] Commit:

```bash
git add src/core/history-tree.ts src/core/history-tree.test.ts
git commit -m "feat(history): pure tree module with append/undo/redo/branch/evict/snapshot"
```

---

## Task 4: Rewrite `history.ts` on top of the tree

Existing call-sites (`document.ts`, `HistoryPanel.tsx`, `MenuBar.tsx`, `keyboard-shortcuts.ts`, `CanvasContextMenu.tsx`) must continue to compile and behave. The public surface stays compatible:
- `push(entry)`, `undo()`, `redo()`, `clear()`, `setRestoreCallback()`, `getUndoStack()`, `getRedoStack()`, `historyStore`.

`getUndoStack()` / `getRedoStack()` are exposed only because `document.ts` uses them for the post-state swap dance. We replace that approach with a tree-aware mechanism (see Task 5) and **mark these two functions deprecated but keep them working** until Task 5 lands; then drop them.

**Files:**
- Modify: `src/core/history.ts`

- [ ] **Step 1: Rewrite the module**

Replace the contents of `src/core/history.ts` with:

```ts
/**
 * HistoryManager — tree-structured undo/redo with named branches.
 *
 * Public surface kept stable for existing callers:
 *   push(entry), undo(), redo(), clear(), setRestoreCallback(), historyStore.
 *
 * New surface (used by Phase 5 UI, available now):
 *   branchFrom(nodeId, name), switchBranch(name), setMilestone(nodeId, label),
 *   jumpTo(nodeId), getTree().
 */
import { createStore } from 'zustand/vanilla';
import type {
  HistoryEntry,
  HistoryNode,
  SerializableState,
} from './types';
import { pixelStore } from './pixel-store';
import * as tree from './history-tree';

const MAX_ENTRIES = 50;
const MAX_MEMORY_BYTES = 500 * 1024 * 1024; // 500 MB

// ─── Reactive store for UI subscriptions ────────────────────────────

export interface HistoryStoreState {
  canUndo: boolean;
  canRedo: boolean;
  /** Linear path from root → current (excludes root). Used by HistoryPanel. */
  entries: HistoryNode[];
  /** Index of the current node within `entries` (-1 if at root). */
  currentIndex: number;
  isRestoring: boolean;
  /** New tree-aware fields (consumed by Phase 5 UI). */
  currentNodeId: string;
  rootId: string;
  branchHeads: Record<string, string>;
}

export const historyStore = createStore<HistoryStoreState>(() => ({
  canUndo: false,
  canRedo: false,
  entries: [],
  currentIndex: -1,
  isRestoring: false,
  currentNodeId: '',
  rootId: '',
  branchHeads: {},
}));

// ─── Internal state ─────────────────────────────────────────────────

let state: tree.HistoryTree | null = null;
let restoreCallback: ((snapshot: SerializableState) => void) | null = null;

function estimateEntrySize(entry: HistoryEntry): number {
  let size = 4096;
  if (entry.pixelSnapshots) {
    for (const blob of entry.pixelSnapshots.values()) size += blob.size;
  }
  return size;
}

function syncStore(): void {
  if (!state) {
    historyStore.setState({
      canUndo: false, canRedo: false, entries: [], currentIndex: -1,
      currentNodeId: '', rootId: '', branchHeads: {},
    });
    return;
  }
  const path = tree.getCurrentPath(state);
  const entriesWithoutRoot = path.slice(1);
  historyStore.setState({
    canUndo: tree.canUndo(state),
    canRedo: tree.canRedo(state),
    entries: entriesWithoutRoot,
    currentIndex: entriesWithoutRoot.length - 1,
    currentNodeId: state.currentNodeId,
    rootId: state.rootId,
    branchHeads: Object.fromEntries(state.branchHeads),
  });
}

function ensureInitialized(initialState?: SerializableState): tree.HistoryTree {
  if (state) return state;
  const seed = initialState ?? {
    layers: [], activeLayerId: null, pixelVersion: 0, graphPositions: {},
  };
  state = tree.createTree(seed);
  return state;
}

// ─── Public API ─────────────────────────────────────────────────────

export function setRestoreCallback(
  cb: (snapshot: SerializableState) => void,
): void {
  restoreCallback = cb;
}

/**
 * Append a history entry as a new child of the current node. `entry.metaSnapshot`
 * is treated as the POST-state of this action (state AFTER the change).
 * Callers in `document.ts` capture the post-state before calling `push`.
 */
export function push(entry: HistoryEntry): void {
  const t = ensureInitialized(entry.metaSnapshot);
  state = tree.append(t, {
    label: entry.label,
    timestamp: entry.timestamp,
    kind: entry.kind,
    metaSnapshot: entry.metaSnapshot,
    pixelSnapshots: entry.pixelSnapshots,
    estimatedSize: estimateEntrySize(entry),
  });
  state = tree.evict(state, { maxEntries: MAX_ENTRIES, maxBytes: MAX_MEMORY_BYTES });
  syncStore();
}

export async function undo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canUndo(state)) return;

  historyStore.setState({ isRestoring: true });
  try {
    state = tree.undo(state);
    const node = state.nodes.get(state.currentNodeId)!;
    restoreCallback(node.metaSnapshot);
    // For destructive nodes, the *child we just moved away from* holds the
    // pre-state pixels. Restore from its pixelSnapshots.
    const childId = findRecentChildId(state, state.currentNodeId);
    if (childId) {
      const child = state.nodes.get(childId)!;
      if (child.pixelSnapshots) {
        await pixelStore.restoreSnapshots(child.pixelSnapshots);
      }
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

export async function redo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canRedo(state)) return;

  historyStore.setState({ isRestoring: true });
  try {
    state = tree.redo(state);
    const node = state.nodes.get(state.currentNodeId)!;
    restoreCallback(node.metaSnapshot);
    // For destructive nodes, the *current node we just moved to* has the
    // post-state pixels stashed alongside (captured at push time on commit).
    if (node.pixelSnapshots && node.kind === 'destructive') {
      await pixelStore.restoreSnapshots(node.pixelSnapshots);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}

/** Find the most-recently-created direct child of `parentId`, if any. */
function findRecentChildId(t: tree.HistoryTree, parentId: string): string | null {
  const parent = t.nodes.get(parentId);
  if (!parent || parent.childIds.length === 0) return null;
  return parent.childIds[parent.childIds.length - 1];
}

export function clear(): void {
  state = null;
  syncStore();
}

/**
 * Seed the tree with the initial document state as its root. Call this from
 * lifecycle entry points (newDocument, openImage, openEdp, restoreSession)
 * after the Zustand store is populated. Without this, the first push() would
 * synthesise a root holding the post-state, and the first undo would be a
 * no-op (root and first child identical).
 */
export function initWith(initialState: SerializableState): void {
  state = tree.createTree(initialState);
  syncStore();
}

/** Tree-aware additions — wired into the UI in Phase 5. */

export function branchFrom(nodeId: string, name: string): void {
  if (!state) return;
  state = tree.branchFrom(state, nodeId, name);
  syncStore();
}

export function switchBranch(name: string): void {
  if (!state || !restoreCallback) return;
  state = tree.switchBranch(state, name);
  const node = state.nodes.get(state.currentNodeId)!;
  restoreCallback(node.metaSnapshot);
  syncStore();
}

export function setMilestone(nodeId: string, label: string): void {
  if (!state) return;
  state = tree.setMilestone(state, nodeId, label);
  syncStore();
}

export function jumpTo(nodeId: string): void {
  if (!state || !restoreCallback) return;
  const node = state.nodes.get(nodeId);
  if (!node) return;
  state = { ...state, currentNodeId: nodeId };
  restoreCallback(node.metaSnapshot);
  syncStore();
}

export function getTree(): tree.HistoryTree | null {
  return state;
}

export function loadTree(t: tree.HistoryTree): void {
  state = t;
  syncStore();
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -b
```
Expected: errors only at `document.ts` callers that use `getUndoStack` / `getRedoStack` (they were removed). The next task fixes them.

- [ ] **Step 3: Stop here — commit happens after document.ts is updated in Task 5.**

---

## Task 5: Rewire `document.ts` for tree-aware undo/redo

The old flat history.ts required `document.ts` to swap pre-state/post-state into entries after each undo/redo (see lines 522–562 of `document.ts`). The new tree stores post-state directly on each node, so the swap dance is gone. We do, however, need to capture pixel post-state for destructive nodes when redoing — that's a small dedicated capture step.

**Files:**
- Modify: `src/core/document.ts`

- [ ] **Step 1: Capture POST-state in `endInteraction` and `flushPendingAction`**

In `src/core/document.ts`, replace the body of `endInteraction()` so it pushes the *current* (post) state, not the pre-state. The new shape:

```ts
function endInteraction(): void {
  if (!interaction) return;
  if (interaction.debounceTimer) clearTimeout(interaction.debounceTimer);

  const post = captureState();
  if (!post) { interaction = null; return; }
  const pre = interaction.preMetaSnapshot;

  if (statesChanged(pre, post)) {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      label: interaction.label,
      timestamp: Date.now(),
      kind: 'metadata',
      metaSnapshot: post,   // ← POST-state now
      estimatedSize: 0,
    };
    history.push(entry);
    markDirty();
  }
  interaction = null;
}
```

And `flushPendingAction()`:

```ts
function flushPendingAction(): void {
  if (!pendingAction) return;
  clearTimeout(pendingAction.timer);
  const post = captureState();
  if (post) {
    if (statesChanged(pendingAction.preSnapshot, post)) {
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        label: pendingAction.label,
        timestamp: Date.now(),
        kind: 'metadata',
        metaSnapshot: post,  // ← POST-state now
        estimatedSize: 0,
      };
      history.push(entry);
      markDirty();
    }
  }
  pendingAction = null;
}
```

- [ ] **Step 2: Commit transactions with POST-state metadata and POST-state pixels**

Replace `commitTransaction()`:

```ts
async function commitTransaction(): Promise<void> {
  const info = transaction.commit();
  const postMeta = captureState();
  if (!postMeta) return;
  // Capture POST-state pixels for redo from the affected layers.
  const postPixels = await pixelStore.captureSnapshots(info.affectedLayerIds);

  // For destructive ops we still need PRE pixels to undo. Stash them on the
  // node — undo() in history.ts reads them via findRecentChildId.
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    label: info.label,
    timestamp: Date.now(),
    kind: 'destructive',
    metaSnapshot: postMeta,
    pixelSnapshots: info.prePixelSnapshots, // PRE pixels stored on this node
    estimatedSize: 0,
  };
  history.push(entry);

  // Stash POST-state pixels on the node we just created, for redo:
  const t = history.getTree();
  if (t && postPixels.size > 0) {
    const current = t.nodes.get(t.currentNodeId);
    if (current && current.kind === 'destructive') {
      // mutate in place — this node is freshly created and not yet observed
      current.pixelSnapshots = mergePixelMaps(info.prePixelSnapshots, postPixels);
      // Actually: we need both PRE (for undo into here) and POST (for redo
      // *to* here). Encoding: keep PRE on parent, POST on current. Below we
      // split: PRE stays on current → used when undoing AWAY from current;
      // POST goes onto current → used when redoing TO current.
      //
      // Simpler: shape pixelSnapshots as { pre, post } per layer. The
      // history.ts undo/redo branches consume the matching half.
      // See Task 5b for the schema upgrade.
    }
  }
  markDirty();
}

function mergePixelMaps(
  pre: Map<string, Blob>,
  post: Map<string, Blob>,
): Map<string, Blob> {
  // Intentionally returns the post map; see Task 5b for the proper split.
  void pre;
  return post;
}
```

> The above sketch surfaces a real semantic issue with destructive pixels: a single `pixelSnapshots` field on a node has to carry *both* PRE and POST or we lose redo fidelity. Task 5b fixes the schema cleanly.

- [ ] **Step 2b: Seed history with the initial state in every document-open path**

In `src/core/document.ts`, after every store-seed in `newDocument`, `openImage`, `openEdp`, and `restoreSession`, call `history.initWith(captureState()!)`. Replace each existing `history.clear()` call with a `history.clear()` followed by a `history.initWith(captureState()!)` once the store has been populated.

Concrete edits:

```ts
// in newDocument(): after the store.setState(...) block:
history.clear();
const seed = captureState();
if (seed) history.initWith(seed);

// in openImage(): after store.setState(...) and graph positions:
const seed = captureState();
if (seed) history.initWith(seed);

// in openEdp(): replace the `history.clear(); history.loadTree(t);` pair —
// loadTree already sets state, so no initWith needed there.

// in restoreSession(): in the else-branch where there's no manifest.history,
// after store.setState(...):
const seed = captureState();
if (seed) history.initWith(seed);
```

- [ ] **Step 3: Remove the now-unused undo/redo swap functions**

Delete from `document.ts`:
- `capturePixelsForTopEntry()`
- `capturePixelsForUndoTop()`
- The post-state patching blocks in `undoAction()` and `redoAction()` (the bits after `await history.undo()` / `await history.redo()` that look up `redoStack` / `undoStack` and mutate entries).

Replace `undoAction()` and `redoAction()` with:

```ts
async function undoAction(): Promise<void> {
  if (transaction.isActive()) {
    await transaction.rollback();
    return;
  }
  if (interaction) endInteraction();
  flushPendingAction();
  await history.undo();
}

async function redoAction(): Promise<void> {
  if (interaction) endInteraction();
  flushPendingAction();
  await history.redo();
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc -b
```
Expected: no errors. (If anything still references `history.getUndoStack` / `getRedoStack`, delete those usages — they're gone from the new history.ts.)

---

## Task 5b: PRE/POST pixel storage per node

Replace the single-Blob-per-layer field on a destructive node with a `{ pre, post }` pair. This is what makes destructive undo *and* redo restore the right pixel state.

**Files:**
- Modify: `src/core/types.ts`, `src/core/history-tree.ts`, `src/core/history.ts`, `src/core/document.ts`, `src/core/history-tree.test.ts`

- [ ] **Step 1: Update `HistoryNode` schema**

In `src/core/types.ts`, replace `pixelSnapshots?: Map<string, Blob>` on `HistoryNode` with:

```ts
  /** PRE-action pixels per layer (used when undoing AWAY from this node). */
  prePixels?: Map<string, Blob>;
  /** POST-action pixels per layer (used when redoing TO this node). */
  postPixels?: Map<string, Blob>;
```

Keep the legacy `pixelSnapshots` on `HistoryEntry` — it's the input handed in by `commitTransaction`; we'll explode it inside `history.push`.

- [ ] **Step 2: Extend `HistoryEntry` so callers can supply both halves**

```ts
export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  kind: 'metadata' | 'destructive';
  metaSnapshot: SerializableState;
  /** @deprecated use prePixels/postPixels — kept for migration */
  pixelSnapshots?: Map<string, Blob>;
  prePixels?: Map<string, Blob>;
  postPixels?: Map<string, Blob>;
  estimatedSize: number;
}
```

- [ ] **Step 3: Plumb pre/post through `history.push`**

In `src/core/history.ts`, update `push`:

```ts
export function push(entry: HistoryEntry): void {
  const t = ensureInitialized(entry.metaSnapshot);
  state = tree.append(t, {
    label: entry.label,
    timestamp: entry.timestamp,
    kind: entry.kind,
    metaSnapshot: entry.metaSnapshot,
    prePixels: entry.prePixels ?? entry.pixelSnapshots,
    postPixels: entry.postPixels,
    estimatedSize: estimateEntrySize(entry),
  });
  state = tree.evict(state, { maxEntries: MAX_ENTRIES, maxBytes: MAX_MEMORY_BYTES });
  syncStore();
}
```

- [ ] **Step 4: Update the tree `append` typing**

In `src/core/history-tree.ts`, update the input type of `append`:

```ts
export function append(
  tree: HistoryTree,
  entry: Omit<HistoryNode, 'id' | 'parentId' | 'childIds'>,
): HistoryTree { /* unchanged body */ }
```

(No body change — `HistoryNode` now carries `prePixels` / `postPixels` so the spread already does the right thing.)

- [ ] **Step 5: Fix `estimateEntrySize` to count both halves**

```ts
function estimateEntrySize(entry: HistoryEntry): number {
  let size = 4096;
  const pre = entry.prePixels ?? entry.pixelSnapshots;
  if (pre) for (const blob of pre.values()) size += blob.size;
  if (entry.postPixels) for (const blob of entry.postPixels.values()) size += blob.size;
  return size;
}
```

- [ ] **Step 6: Restore the right half during undo/redo**

In `src/core/history.ts`, update `undo()`:

```ts
export async function undo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canUndo(state)) return;

  historyStore.setState({ isRestoring: true });
  try {
    const leaving = state.nodes.get(state.currentNodeId);
    state = tree.undo(state);
    const arrived = state.nodes.get(state.currentNodeId)!;
    restoreCallback(arrived.metaSnapshot);
    // We're undoing AWAY from `leaving`. Use its prePixels to restore the
    // pixel state that existed BEFORE that action.
    if (leaving?.kind === 'destructive' && leaving.prePixels) {
      await pixelStore.restoreSnapshots(leaving.prePixels);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}
```

And `redo()`:

```ts
export async function redo(): Promise<void> {
  if (!state || !restoreCallback || historyStore.getState().isRestoring) return;
  if (!tree.canRedo(state)) return;

  historyStore.setState({ isRestoring: true });
  try {
    state = tree.redo(state);
    const node = state.nodes.get(state.currentNodeId)!;
    restoreCallback(node.metaSnapshot);
    if (node.kind === 'destructive' && node.postPixels) {
      await pixelStore.restoreSnapshots(node.postPixels);
    }
  } finally {
    historyStore.setState({ isRestoring: false });
    syncStore();
  }
}
```

Delete `findRecentChildId` — no longer needed.

- [ ] **Step 7: Update `commitTransaction` to supply both halves**

In `src/core/document.ts`:

```ts
async function commitTransaction(): Promise<void> {
  const info = transaction.commit();
  const postMeta = captureState();
  if (!postMeta) return;
  const postPixels = await pixelStore.captureSnapshots(info.affectedLayerIds);

  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    label: info.label,
    timestamp: Date.now(),
    kind: 'destructive',
    metaSnapshot: postMeta,
    prePixels: info.prePixelSnapshots,
    postPixels,
    estimatedSize: 0,
  };
  history.push(entry);
  markDirty();
}
```

Remove the temporary `mergePixelMaps` helper added in Task 5.

- [ ] **Step 8: Adjust the tree snapshot encoding**

In `src/core/types.ts`, the existing `pixelLayerIds?` field on the snapshot node is no longer enough. Replace with two fields:

```ts
  nodes: Record<string, Omit<HistoryNode, 'prePixels' | 'postPixels'> & {
    prePixelLayerIds?: string[];
    postPixelLayerIds?: string[];
  }>;
```

In `src/core/history-tree.ts`, update `toSnapshot` / `fromSnapshot` accordingly:

```ts
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
    branchHeads: Object.fromEntries(tree.branchHeads),
  };
}

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
    branchHeads: new Map(Object.entries(snapshot.branchHeads)),
  };
}
```

- [ ] **Step 9: Update the snapshot-round-trip test**

Replace the existing snapshot test's blob handling with a fixture that exercises both pre and post:

```ts
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
```

- [ ] **Step 10: Run the full vitest suite**

```bash
npm run test:run
```
Expected: all tree tests pass (13 total now).

- [ ] **Step 11: Run `npm run check`**

```bash
npm run check
```
Expected: green.

- [ ] **Step 12: Commit Tasks 4 + 5 + 5b together**

```bash
git add src/core/history.ts src/core/history-tree.ts src/core/history-tree.test.ts src/core/types.ts src/core/document.ts
git commit -m "feat(history): tree-backed HistoryManager with PRE/POST pixel storage

- history.ts rewritten on top of pure history-tree module
- HistoryEntry/HistoryNode carry prePixels + postPixels (destructive)
- document.ts captures POST-state on commit, drops the post-state swap dance
- new tree API exposed (branchFrom, switchBranch, setMilestone, jumpTo)"
```

---

## Task 6: HistoryPanel reads from the new linear path

`HistoryPanel.tsx` already reads `entries` from `historyStore`. The shape of `entries` changed from `HistoryEntry[]` to `HistoryNode[]`. The fields it touches (`label`, `kind`, `id`) exist on both, but the import type is wrong. Adjust it.

**Files:**
- Modify: `src/components/panels/HistoryPanel.tsx`

- [ ] **Step 1: Update the local types**

In `src/components/panels/HistoryPanel.tsx`, change the import:

```ts
import type { HistoryStoreState } from '@/core/history';
```

remains correct — `HistoryStoreState.entries` is now `HistoryNode[]`. Verify nothing in the panel uses fields that don't exist on `HistoryNode`. The fields used today (`entry.id`, `entry.label`, `entry.kind`) all exist on `HistoryNode`. No code change needed except verifying.

- [ ] **Step 2: Adjust the "click an old entry" behaviour to use `jumpTo`**

Replace `handleClick`:

```ts
import { editorDocument } from '@/core/document';
import * as history from '@/core/history';

const handleClick = async (index: number) => {
  if (isRestoring) return;
  const path = history.getTree();
  if (!path) return;
  // entries is path[1..]; index 0 = root
  const entries = useHistoryStore.getState ? null : null; // placeholder
  // Resolve node ID by walking the current path:
  // - index 0 → root
  // - index N → entries[N-1].id
  const tree = path;
  const allPath = (await import('@/core/history-tree')).getCurrentPath(tree);
  if (index < 0 || index >= allPath.length) return;
  history.jumpTo(allPath[index].id);
  void editorDocument; // remove if unused
};
```

> Simpler: expose a sibling function `currentPathNodes()` on `history.ts` and call it directly. Rewrite `handleClick`:

In `src/core/history.ts`, append:

```ts
export function getCurrentPathNodes(): HistoryNode[] {
  if (!state) return [];
  return tree.getCurrentPath(state);
}
```

Then in `HistoryPanel.tsx`:

```ts
import * as history from '@/core/history';

const handleClick = (index: number) => {
  if (isRestoring) return;
  const path = history.getCurrentPathNodes();
  if (index < 0 || index >= path.length) return;
  history.jumpTo(path[index].id);
};
```

Remove the now-unused `editorDocument` import if no longer referenced. Drop the `for (...) editorDocument.undo()` loop entirely.

- [ ] **Step 3: Run check**

```bash
npm run check
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/core/history.ts src/components/panels/HistoryPanel.tsx
git commit -m "feat(history): HistoryPanel jumps via tree pointer (no more undo loops)"
```

---

## Task 7: Manifest v2 — extend `.edp` with the tree

**Files:**
- Modify: `src/core/serializer.ts`
- Create: `src/core/serializer-migrate.ts`

- [ ] **Step 1: Add `serializer-migrate.ts`**

Write `src/core/serializer-migrate.ts`:

```ts
/**
 * Migrate a v1 (.edp manifest) to v2 by synthesising a linear `main` branch
 * containing the root node only (i.e. starting fresh, no history retained
 * from the old flat file). This is the spec's stated migration policy: open
 * an old project, get its current state as the new root.
 */
import type { HistoryTreeSnapshot, SerializableState, DocumentMeta } from './types';

export interface ManifestV1 {
  version: 1;
  meta: DocumentMeta;
  layers: unknown[];
  activeLayerId: string | null;
  graphPositions: Record<string, unknown>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  curvePoints?: Record<string, Record<string, number[]>>;
}

export interface ManifestV2 extends Omit<ManifestV1, 'version'> {
  version: 2;
  history: HistoryTreeSnapshot;
}

export function isV1(m: { version: number }): m is ManifestV1 {
  return m.version === 1;
}

export function migrateV1ToV2(
  m: ManifestV1,
  rootState: SerializableState,
): ManifestV2 {
  const rootId = crypto.randomUUID();
  const history: HistoryTreeSnapshot = {
    nodes: {
      [rootId]: {
        id: rootId,
        parentId: null,
        childIds: [],
        label: 'Initial (migrated)',
        timestamp: m.meta.modifiedAt ?? Date.now(),
        kind: 'root',
        metaSnapshot: rootState,
        estimatedSize: 4096,
      },
    },
    rootId,
    currentNodeId: rootId,
    branchHeads: { main: rootId },
  };
  return { ...m, version: 2, history };
}
```

- [ ] **Step 2: Update `serializer.ts` to write v2**

In `src/core/serializer.ts`, change the `Manifest` interface:

```ts
import type { HistoryTreeSnapshot } from './types';

interface Manifest {
  version: 2;
  meta: DocumentMeta;
  layers: SerializableLayer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  curvePoints?: Record<string, Record<string, number[]>>;
  history: HistoryTreeSnapshot;
}
```

Update `save` to require a history snapshot:

```ts
export interface SaveOptions {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  history: HistoryTreeSnapshot;
  pixelBlobs: Map<string, Blob>; // key format: `${nodeId}:${pre|post}:${layerId}`
}

export async function save(options: SaveOptions): Promise<Blob> {
  const { meta, layers, activeLayerId, graphPositions, viewport, history, pixelBlobs } = options;
  const files: Record<string, Uint8Array> = {};

  // (layer pixel snapshots unchanged — collect into pixels/{id}-source.png etc.)
  // ... existing layer loop ...

  // Persist history pixel blobs under history/{nodeId}/{pre|post}/{layerId}.png
  for (const [key, blob] of pixelBlobs) {
    const [nodeId, kind, layerId] = key.split(':');
    files[`history/${nodeId}/${kind}/${layerId}.png`] = new Uint8Array(
      await blob.arrayBuffer(),
    );
  }

  const manifest: Manifest = {
    version: 2,
    meta,
    layers: serializableLayers,
    activeLayerId,
    graphPositions,
    viewport,
    curvePoints: exportAllCurvePoints(),
    history,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['thumbnail.png'] = await generateThumbnail();

  const zipped = zipSync(files, { level: 6 });
  return new Blob([new Uint8Array(zipped)], { type: 'application/x-edp' });
}
```

- [ ] **Step 3: Update `load` to handle v1 + v2**

```ts
import { migrateV1ToV2, isV1, type ManifestV1 } from './serializer-migrate';

export interface LoadResult {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  history: HistoryTreeSnapshot;
  historyPixelBlobs: Map<string, Blob>;
}

export async function load(blob: Blob): Promise<LoadResult> {
  const buffer = await blob.arrayBuffer();
  const files = unzipSync(new Uint8Array(buffer));

  const manifestData = files['manifest.json'];
  if (!manifestData) throw new Error('Invalid .edp: missing manifest.json');
  const raw = JSON.parse(strFromU8(manifestData));

  let manifest: Manifest;
  if (raw.version === 2) {
    manifest = raw as Manifest;
  } else if (isV1(raw)) {
    // Build the rootState from the v1 fields we already know
    const rootState: SerializableState = {
      layers: raw.layers.map(deserializeLayer) as Layer[],
      activeLayerId: raw.activeLayerId,
      pixelVersion: 0,
      graphPositions: raw.graphPositions as Record<string, NodePosition>,
    };
    manifest = migrateV1ToV2(raw as ManifestV1, rootState) as unknown as Manifest;
  } else {
    throw new Error(`Unsupported .edp manifest version: ${raw.version}`);
  }

  // (layer pixel loading unchanged — pixels/{id}-source.png etc.)
  // ... existing layer pixel loop ...

  // Load history pixel blobs
  const historyPixelBlobs = new Map<string, Blob>();
  for (const path of Object.keys(files)) {
    const match = path.match(/^history\/([^/]+)\/(pre|post)\/([^/]+)\.png$/);
    if (!match) continue;
    const [, nodeId, kind, layerId] = match;
    historyPixelBlobs.set(
      `${nodeId}:${kind}:${layerId}`,
      new Blob([new Uint8Array(files[path])], { type: 'image/png' }),
    );
  }

  if (manifest.curvePoints) importAllCurvePoints(manifest.curvePoints);

  return {
    meta: manifest.meta,
    layers: manifest.layers.map(deserializeLayer),
    activeLayerId: manifest.activeLayerId,
    graphPositions: manifest.graphPositions,
    viewport: manifest.viewport,
    history: manifest.history,
    historyPixelBlobs,
  };
}
```

- [ ] **Step 4: Wire `document.ts` to the new save/load shape**

In `src/core/document.ts`, update `save()`:

```ts
async function save(): Promise<Blob | null> {
  if (!store) return null;
  const s = store.getState();
  if (!s.documentMeta) return null;

  const updatedMeta = { ...s.documentMeta, modifiedAt: Date.now() };
  store.setState({ documentMeta: updatedMeta });

  const t = history.getTree();
  const historySnapshot = t
    ? (await import('@/core/history-tree')).toSnapshot(t)
    : (await import('@/core/history-tree')).toSnapshot(
        (await import('@/core/history-tree')).createTree(captureState()!),
      );

  const pixelBlobs = new Map<string, Blob>();
  if (t) {
    for (const node of t.nodes.values()) {
      if (node.prePixels) {
        for (const [layerId, blob] of node.prePixels) {
          pixelBlobs.set(`${node.id}:pre:${layerId}`, blob);
        }
      }
      if (node.postPixels) {
        for (const [layerId, blob] of node.postPixels) {
          pixelBlobs.set(`${node.id}:post:${layerId}`, blob);
        }
      }
    }
  }

  const blob = await serializer.save({
    meta: updatedMeta,
    layers: s.layers,
    activeLayerId: s.activeLayerId,
    graphPositions: useGraphStore.getState().graphPositions,
    viewport: {
      zoom: s.zoom ?? 1,
      panX: s.panX ?? 0,
      panY: s.panY ?? 0,
      fitMode: s.fitMode ?? 'fit',
    },
    history: historySnapshot,
    pixelBlobs,
  });

  markClean();
  return blob;
}
```

Update `openEdp()`:

```ts
async function openEdp(file: File): Promise<void> {
  const result = await serializer.load(file);

  // Rebuild history tree from snapshot
  const treeMod = await import('@/core/history-tree');
  const t = treeMod.fromSnapshot(result.history, result.historyPixelBlobs);
  history.clear();
  history.loadTree(t);

  if (store) {
    store.setState({
      layers: result.layers,
      activeLayerId: result.activeLayerId,
      pixelVersion: 0,
      zoom: result.viewport.zoom,
      panX: result.viewport.panX,
      panY: result.viewport.panY,
      fitMode: asFitMode(result.viewport.fitMode),
      documentMeta: result.meta,
      isDirty: false,
      editorMode: 'develop',
    });
  }
  useGraphStore.getState().setGraphPositions(result.graphPositions);
  scheduleSessionSave();
}
```

- [ ] **Step 5: Type-check + lint**

```bash
npm run check
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/core/serializer.ts src/core/serializer-migrate.ts src/core/document.ts
git commit -m "feat(edp): manifest v2 with history tree; loader migrates v1 → v2"
```

---

## Task 8: Migration fixtures + round-trip tests

The spec requires "≥3 historical `.edp` files round-trip without loss". Since real `.edp` files are binary ZIPs, the cheapest equivalent is a JSON fixture for the manifest content + a unit test that runs it through `migrateV1ToV2` then reads back.

**Files:**
- Create: `tests/fixtures/edp-v1-empty.json`
- Create: `tests/fixtures/edp-v1-single-image.json`
- Create: `tests/fixtures/edp-v1-with-text.json`
- Create: `src/core/serializer-migrate.test.ts`

- [ ] **Step 1: Add fixtures**

Write `tests/fixtures/edp-v1-empty.json`:

```json
{
  "version": 1,
  "meta": {
    "id": "empty-doc",
    "name": "Empty",
    "createdAt": 1700000000000,
    "modifiedAt": 1700000000000,
    "width": 0,
    "height": 0
  },
  "layers": [],
  "activeLayerId": null,
  "graphPositions": {},
  "viewport": { "zoom": 1, "panX": 0, "panY": 0, "fitMode": "fit" }
}
```

Write `tests/fixtures/edp-v1-single-image.json`:

```json
{
  "version": 1,
  "meta": {
    "id": "single-img",
    "name": "Photo",
    "createdAt": 1700000000000,
    "modifiedAt": 1700000100000,
    "width": 1920,
    "height": 1080
  },
  "layers": [
    {
      "id": "layer-1",
      "type": "image",
      "name": "Background",
      "visible": true,
      "opacity": 1,
      "blendMode": "normal",
      "locked": false,
      "order": 0,
      "adjustmentStack": {
        "adjustments": [
          {
            "id": "adj-1",
            "type": "basic",
            "name": "Light",
            "enabled": true,
            "blendMode": "normal",
            "opacity": 1,
            "params": { "exposure": 0.3, "contrast": 0.1 }
          }
        ]
      },
      "hasWorkingPixels": false
    }
  ],
  "activeLayerId": "layer-1",
  "graphPositions": { "layer-1": { "x": 100, "y": 100 } },
  "viewport": { "zoom": 1, "panX": 0, "panY": 0, "fitMode": "fit" }
}
```

Write `tests/fixtures/edp-v1-with-text.json`:

```json
{
  "version": 1,
  "meta": {
    "id": "with-text",
    "name": "Captioned",
    "createdAt": 1700000000000,
    "modifiedAt": 1700000200000,
    "width": 1920,
    "height": 1080
  },
  "layers": [
    {
      "id": "img-1",
      "type": "image",
      "name": "Background",
      "visible": true,
      "opacity": 1,
      "blendMode": "normal",
      "locked": false,
      "order": 0,
      "adjustmentStack": { "adjustments": [] },
      "cropMeta": { "x": 0, "y": 0, "width": 1920, "height": 1080, "rotation": 0, "flipH": false, "flipV": false },
      "hasWorkingPixels": false
    },
    {
      "id": "txt-1",
      "type": "text",
      "name": "Caption",
      "visible": true,
      "opacity": 1,
      "blendMode": "normal",
      "locked": false,
      "order": 1,
      "adjustmentStack": { "adjustments": [] },
      "textMeta": { "text": "Hello", "x": 100, "y": 100, "fontSize": 48, "fontFamily": "SF Pro", "color": "#ffffff" },
      "hasWorkingPixels": false
    }
  ],
  "activeLayerId": "img-1",
  "graphPositions": {},
  "viewport": { "zoom": 0.5, "panX": 100, "panY": 50, "fitMode": "fit" }
}
```

> If your `cropMeta` / `textMeta` shape differs from the above, regenerate the fixtures by saving a real document and dumping its manifest JSON. The fixtures only need to be *valid v1 manifests*, not specific contents — the test asserts structural migration, not field equality.

- [ ] **Step 2: Write the migration test**

Write `src/core/serializer-migrate.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { migrateV1ToV2, type ManifestV1 } from './serializer-migrate';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../../tests/fixtures');

function loadFixture(name: string): ManifestV1 {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf-8'));
}

describe.each([
  'edp-v1-empty.json',
  'edp-v1-single-image.json',
  'edp-v1-with-text.json',
])('migrateV1ToV2(%s)', (fixture) => {
  it('produces a v2 manifest with a linear main branch and current=root', () => {
    const v1 = loadFixture(fixture);
    const v2 = migrateV1ToV2(v1, {
      layers: [],
      activeLayerId: v1.activeLayerId,
      pixelVersion: 0,
      graphPositions: {},
    });
    expect(v2.version).toBe(2);
    expect(v2.history).toBeDefined();
    expect(v2.history.rootId).toBe(v2.history.currentNodeId);
    expect(v2.history.branchHeads.main).toBe(v2.history.rootId);
    // All v1 top-level fields preserved
    expect(v2.meta).toEqual(v1.meta);
    expect(v2.layers).toEqual(v1.layers);
    expect(v2.activeLayerId).toEqual(v1.activeLayerId);
    expect(v2.viewport).toEqual(v1.viewport);
  });
});
```

- [ ] **Step 3: Run**

```bash
npm run test:run
```
Expected: 3 new migration tests pass; all tree tests still pass.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures src/core/serializer-migrate.test.ts
git commit -m "test(edp): v1 → v2 migration fixtures + round-trip assertions"
```

---

## Task 9: Session-storage with the tree

`session-storage.ts` is the IndexedDB auto-save. It needs to round-trip the tree alongside layer state.

**Files:**
- Modify: `src/core/session-storage.ts`
- Modify: `src/core/document.ts`

- [ ] **Step 1: Extend the session manifest**

In `src/core/session-storage.ts`, add to `SessionManifest`:

```ts
interface SessionManifest {
  meta: DocumentMeta;
  layers: SerializableLayer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  editorMode: string;
  savedAt: number;
  curvePoints?: Record<string, Record<string, number[]>>;
  /** Tree-structured history; absent in pre-v2 sessions. */
  history?: HistoryTreeSnapshot;
}
```

Add to top imports:

```ts
import type { HistoryTreeSnapshot } from './types';
```

- [ ] **Step 2: Persist history blobs in a new object store**

Bump `DB_VERSION` from 1 to 2 and create a new store `'history-pixels'`:

```ts
const DB_VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('pixels')) db.createObjectStore('pixels');
      if (!db.objectStoreNames.contains('history-pixels')) db.createObjectStore('history-pixels');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 3: Save tree + history blobs**

Extend `SaveSessionOptions`:

```ts
export interface SaveSessionOptions {
  meta: DocumentMeta;
  layers: Layer[];
  activeLayerId: string | null;
  graphPositions: Record<string, NodePosition>;
  viewport: { zoom: number; panX: number; panY: number; fitMode: string };
  editorMode: string;
  history?: HistoryTreeSnapshot;
  historyPixelBlobs?: Map<string, Blob>;
  pixelStore: {
    has(id: string): boolean;
    exportLayerAsPng(id: string, which: 'source' | 'working'): Promise<Blob>;
  };
}
```

And in `saveSession`, after writing layer pixels:

```ts
    // Write history pixel blobs
    await idbClear(db, 'history-pixels');
    if (historyPixelBlobs) {
      for (const [key, blob] of historyPixelBlobs) {
        await idbPut(db, 'history-pixels', key, blob);
      }
    }
```

Set `manifest.history = options.history` before the `idbPut(state, 'current', manifest)` call.

- [ ] **Step 4: Load tree + history blobs**

Extend `SessionData`:

```ts
export interface SessionData {
  manifest: SessionManifest;
  pixels: Map<string, Blob>;
  /** key format: `${nodeId}:${pre|post}:${layerId}` */
  historyPixels: Map<string, Blob>;
}
```

In `loadSession`:

```ts
    const historyPixels = new Map<string, Blob>();
    const hKeys = await idbGetAllKeys(db, 'history-pixels');
    for (const key of hKeys) {
      const blob = await idbGet<Blob>(db, 'history-pixels', key);
      if (blob) historyPixels.set(key, blob);
    }
```

Return `{ manifest, pixels, historyPixels }`.

- [ ] **Step 5: Wire `document.ts` `persistSession` to supply the tree**

In `document.ts`:

```ts
function persistSession(): void {
  if (!store) return;
  const s = store.getState();
  if (!s.documentMeta) return;
  const t = history.getTree();
  let historySnapshot: HistoryTreeSnapshot | undefined;
  let historyPixelBlobs: Map<string, Blob> | undefined;
  if (t) {
    // dynamic import to avoid a cycle with history-tree
    void import('@/core/history-tree').then((mod) => {
      historySnapshot = mod.toSnapshot(t);
      historyPixelBlobs = new Map();
      for (const node of t.nodes.values()) {
        if (node.prePixels) for (const [lid, blob] of node.prePixels) {
          historyPixelBlobs!.set(`${node.id}:pre:${lid}`, blob);
        }
        if (node.postPixels) for (const [lid, blob] of node.postPixels) {
          historyPixelBlobs!.set(`${node.id}:post:${lid}`, blob);
        }
      }
      session.saveSession({
        meta: s.documentMeta!,
        layers: s.layers,
        activeLayerId: s.activeLayerId,
        graphPositions: useGraphStore.getState().graphPositions,
        viewport: { zoom: s.zoom ?? 1, panX: s.panX ?? 0, panY: s.panY ?? 0, fitMode: s.fitMode ?? 'fit' },
        editorMode: s.editorMode ?? 'develop',
        history: historySnapshot,
        historyPixelBlobs,
        pixelStore,
      }).catch(() => {});
    });
    return;
  }
  // No tree yet — fall back to old shape (saves layer pixels only)
  session.saveSession({
    meta: s.documentMeta,
    layers: s.layers,
    activeLayerId: s.activeLayerId,
    graphPositions: useGraphStore.getState().graphPositions,
    viewport: { zoom: s.zoom ?? 1, panX: s.panX ?? 0, panY: s.panY ?? 0, fitMode: s.fitMode ?? 'fit' },
    editorMode: s.editorMode ?? 'develop',
    pixelStore,
  }).catch(() => {});
}
```

> Static import is cleaner — change `import * as treeMod from './history-tree'` at the top of `document.ts` (it doesn't create a cycle since history-tree has no imports from document).

Replace the dynamic-import dance with:

```ts
import * as historyTree from '@/core/history-tree';
// ...inside persistSession...
const historySnapshot = t ? historyTree.toSnapshot(t) : undefined;
```

- [ ] **Step 6: Wire `restoreSession` to rebuild the tree**

In `document.ts`, update `restoreSession`:

```ts
async function restoreSession(): Promise<boolean> {
  if (!store) return false;
  const data = await session.loadSession();
  if (!data) return false;

  const { manifest, pixels, historyPixels } = data;

  pixelStore.clear();
  for (const [layerId, blob] of pixels) {
    if (layerId.endsWith('-original')) continue;
    await pixelStore.importLayerFromPng(layerId, blob, 'source');
  }

  const layers = session.deserializeSessionLayers(manifest);

  if (manifest.history) {
    const t = historyTree.fromSnapshot(manifest.history, historyPixels);
    history.clear();
    history.loadTree(t);
  } else {
    history.clear();
  }

  store.setState({
    layers,
    activeLayerId: manifest.activeLayerId,
    pixelVersion: (store.getState().pixelVersion ?? 0) + 1,
    zoom: manifest.viewport.zoom,
    panX: manifest.viewport.panX,
    panY: manifest.viewport.panY,
    fitMode: asFitMode(manifest.viewport.fitMode),
    editorMode: asEditorMode(manifest.editorMode ?? 'develop'),
    documentMeta: manifest.meta,
    isDirty: false,
  });
  useGraphStore.getState().setGraphPositions(manifest.graphPositions);
  return true;
}
```

- [ ] **Step 7: Run `npm run check`**

```bash
npm run check
```
Expected: green. Tree tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/session-storage.ts src/core/document.ts
git commit -m "feat(session): persist tree history + per-node pixels in IndexedDB"
```

---

## Task 10: Manual smoke + exit-criteria verification

Pure-TS tests cover the data layer; the UX exit criteria need a real browser. This task is a hand-driven smoke checklist.

- [ ] **Step 1: Boot dev server + backend**

```bash
npm run dev &
npm run dev:backend &
```

- [ ] **Step 2: Smoke checklist**

Open `http://localhost:5173` and walk through:

- [ ] Open a JPEG via menu. Editor shows the image.
- [ ] Adjust the exposure slider; release; observe a new history entry appears.
- [ ] Cmd+Z undoes; image reverts; Cmd+Shift+Z redoes; image returns.
- [ ] Drag the slider rapidly (5+ moves within 2 s); release; one history entry is created (not 5).
- [ ] Use the brush tool on the image; one destructive-kind entry appears (marked with the `px` badge in HistoryPanel).
- [ ] Cmd+Z reverts the brush stroke pixel-perfectly. Cmd+Shift+Z replays it.
- [ ] Save the document as `smoke.edp`. Reload the page. Restore from session — image + adjustment present, history restored to the same current pointer.
- [ ] Open `smoke.edp` from disk in a fresh tab — image + adjustment present (no history pre-v2 expectation; history may be empty or single-root).

- [ ] **Step 3: Spec exit-criterion test**

Run:
```bash
npm run test:run -- -t "spec exit criterion"
```
Expected: the `commit → branch → switch → commit → switch back → undo` test passes.

- [ ] **Step 4: Check pass**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 5: Verify no nested-component violations introduced**

```bash
npm run lint:rules
```
Expected: green.

- [ ] **Step 6: Final commit (if any fix-ups were needed)**

```bash
git status
# Commit any fix-ups with: git commit -m "fix(history): <whatever>"
```

- [ ] **Step 7: Tag the phase exit**

```bash
git tag -a phase-2-exit -m "Phase 2: tree-history refactor complete (spec §4 P2)"
```

---

## Spec coverage check

| Spec deliverable (§4 P2) | Plan task |
|---|---|
| Rewrite `src/core/history.ts` with tree node shape | Task 3, Task 4 |
| API: `commit/undo/redo/branchFrom/switchBranch/setMilestone/getCurrentPath` | Task 3, Task 4 (named `push/undo/redo/...`) |
| Eviction: 50-entry / 500 MB, milestone-preserving | Task 3 step 12–13 |
| Transaction system preserved | Task 5, Task 5b |
| `ACTION_DEBOUNCE_MS = 250 ms`, 2 s slider window, on-pointer-release commit | Task 5 (unchanged in `document.ts`) |
| `.edp` manifest extended with tree | Task 7 |
| Migration loader (v1 → linear main) | Task 7 step 3, Task 8 |
| Migration test fixtures (≥3) round-trip | Task 8 |
| `HistoryPanel.tsx` reads tree API (linear path) | Task 6 |
| Undo/redo shortcuts in `MenuBar` + `KeyboardShortcuts` updated | Task 4 (no signature change — call-sites untouched) |
| IndexedDB session handles tree | Task 9 |

| Spec exit criterion (§4 P2) | Plan task |
|---|---|
| Existing flows unchanged from user perspective | Task 10 step 2 |
| Unit test: commit → branch → switch → commit → switch back → undo | Task 3 step 9, Task 10 step 3 |
| `npm run check` passes; no nested-component violations | Task 10 step 4–5 |

