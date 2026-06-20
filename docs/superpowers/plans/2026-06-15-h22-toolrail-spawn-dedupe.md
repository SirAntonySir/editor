# H22 — Toolrail Spawn Context Dedupe

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the duplicated "resolve active session + image node + layer + scope" logic in `src/lib/toolrail-spawn.ts` to one helper.

**Architecture:** The file today has `spawnToolWidget` (lines 39–72) and `_resolveSpawnContext` (lines 78–99) computing nearly identical context: session id, active ImageNode, resolved layer id, and a `_scopeForSpawn`-derived `Scope`. The toolrail-click path slightly extends this with a tool-lookup gate. We unify by making `_resolveSpawnContext` the only resolver and having `spawnToolWidget` call it.

**Tech Stack:** TypeScript (strict), Zustand, React Testing Library + Vitest.

**Audit reference:** `docs/audit-2026-06-15.md`, H22.

---

## What's duplicated today

Both functions perform the same 5-step gate before doing different things with the result:

1. Read `useEditorStore.getState()`.
2. Check `activeImageNodeId`; toast "Select an image first." and bail when absent.
3. Read `useBackendState.getState().sessionId`; bail when absent.
4. Look up `node = editor.imageNodes[activeImageNodeId]`; bail when missing.
5. Resolve `layerId = node.layerIds.includes(editor.activeLayerId) ? editor.activeLayerId : node.layerIds[0]`; bail when missing.

`spawnToolWidget` adds a pre-step (look up `CanvasToolRegistry.get(toolName)`) and post-step (call `proposeStack` with `forced_ops: [tool.processingId]`). `_resolveSpawnContext` returns the context for `spawnRegistryOp` / `spawnRegistryPreset` to consume.

## What the cleanup looks like

- Promote `_resolveSpawnContext` to the single source of truth for spawn context. Keep it module-private (underscore prefix retained).
- `spawnToolWidget` becomes: (a) registry lookup, (b) call `_resolveSpawnContext()`, (c) `proposeStack({..., forced_ops: [tool.processingId]})`.
- No public-API change. No new exports. No new files.
- The toast behaviour is unchanged: it was inside the now-shared resolver already.

---

## File structure

- Modify: `src/lib/toolrail-spawn.ts`
- Modify: `src/lib/toolrail-spawn.test.ts`

## Task 1: Extend the existing tests to lock in the toast + bail behaviour for `spawnToolWidget`

The current test (per the implementer-spawn integration from the multi-image work) already asserts `spawnToolWidget` emits an `image_node` scope when a node is active. We add two cases that lock in the gated-out paths so the refactor can't silently change them.

**Files:**
- Modify: `src/lib/toolrail-spawn.test.ts`

- [ ] **Step 1: Read the existing test file**

```bash
cat /Users/anton/Dev/Projects/editor/src/lib/toolrail-spawn.test.ts
```

Note the existing setup (Zustand store seeding, `backendTools.proposeStack` spy, toast spy if any). The new tests must follow the same pattern.

- [ ] **Step 2: Add two regression tests**

Append inside the existing `describe('spawnToolWidget', …)` block (or create one if missing):

```ts
it('shows a toast and returns true when no active image node', () => {
  useEditorStore.setState({ activeImageNodeId: null, imageNodes: {} });
  const toastSpy = vi.spyOn(toast, 'info').mockImplementation(() => {});
  const spawnSpy = vi.spyOn(backendTools, 'proposeStack').mockResolvedValue({} as never);

  const handled = spawnToolWidget('light');

  expect(handled).toBe(true);
  expect(toastSpy).toHaveBeenCalledWith('Select an image first.');
  expect(spawnSpy).not.toHaveBeenCalled();
});

it('returns true without toast or proposeStack when no backend session', () => {
  useEditorStore.setState({
    activeImageNodeId: 'in-1',
    activeLayerId: 'l1',
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['l1'], position: { x: 0, y: 0 },
                size: { w: 1, h: 1 }, sourceSize: { w: 1, h: 1 } },
    },
  });
  useBackendState.setState({ sessionId: null } as never);
  const toastSpy = vi.spyOn(toast, 'info').mockImplementation(() => {});
  const spawnSpy = vi.spyOn(backendTools, 'proposeStack').mockResolvedValue({} as never);

  const handled = spawnToolWidget('light');

  expect(handled).toBe(true);
  expect(toastSpy).not.toHaveBeenCalled();
  expect(spawnSpy).not.toHaveBeenCalled();
});
```

Imports to add (or extend existing ones) at the top of the file:

```ts
import { toast } from '@/components/ui/Toast';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
```

`'light'` must be a tool name that `CanvasToolRegistry.get('light')` returns with a `processingId`. Confirm by grepping `CanvasToolRegistry.register` — if `'light'` isn't registered in tests, use a tool name that IS, or seed one via `CanvasToolRegistry.register(...)` in a `beforeEach`.

- [ ] **Step 3: Run the new tests and confirm they pass before the refactor**

```bash
cd /Users/anton/Dev/Projects/editor && npm run test -- src/lib/toolrail-spawn.test.ts
```

Expected: PASS. (They lock in CURRENT behaviour. If they fail here, the existing implementation drifted from spec and that's the first thing to fix.)

- [ ] **Step 4: Commit the test additions**

```bash
git add src/lib/toolrail-spawn.test.ts
git commit -m "$(cat <<'EOF'
test(toolrail-spawn): lock in gate behaviour before dedupe refactor

Adds regression tests for the no-active-node toast path and the
no-backend-session silent bail, so the upcoming dedupe can't change
either by accident.

Audit follow-up — H22.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Refactor `spawnToolWidget` to use `_resolveSpawnContext`

**Files:**
- Modify: `src/lib/toolrail-spawn.ts`

- [ ] **Step 1: Read the current file**

```bash
cat /Users/anton/Dev/Projects/editor/src/lib/toolrail-spawn.ts
```

Confirm `_resolveSpawnContext` exists at line ~78 and returns `{ sid, layerId, scope }`.

- [ ] **Step 2: Replace `spawnToolWidget`'s body**

Edit `src/lib/toolrail-spawn.ts`. Replace the entire body of `spawnToolWidget` (lines 39–72 in current file) so it reads:

```ts
export function spawnToolWidget(toolName: string): boolean {
  const tool = CanvasToolRegistry.get(toolName);
  if (!tool?.processingId) return false;

  const ctx = _resolveSpawnContext();
  if (!ctx) return true;

  void backendTools.proposeStack(ctx.sid, {
    intent: tool.label ?? tool.processingId,
    scope: ctx.scope,
    forced_ops: [tool.processingId],
    layerId: ctx.layerId,
    origin: 'tool_invoked',
  });
  return true;
}
```

Delete the now-unused imports if any (likely none — `useEditorStore`, `useBackendState`, `GLOBAL_SCOPE` are still used by `_scopeForSpawn` and `_resolveSpawnContext`).

Note: the public `boolean` return contract is preserved. `false` still means "this toolrail click isn't backed by a processing definition — caller (the toolrail UI) should handle the click as canvas tool". `true` means "we handled it (spawned, toasted, or silently bailed on missing session)".

- [ ] **Step 3: Run the full toolrail-spawn test file**

```bash
cd /Users/anton/Dev/Projects/editor && npm run test -- src/lib/toolrail-spawn.test.ts
```

Expected: all tests PASS (including the new ones from Task 1 and the original `image_node` scope test).

- [ ] **Step 4: Run the full check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors, all 773+ tests pass, 5 pre-existing warnings allowed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/toolrail-spawn.ts
git commit -m "$(cat <<'EOF'
refactor(toolrail-spawn): unify spawn context resolution

spawnToolWidget now calls _resolveSpawnContext for session + active image
node + layer + scope resolution, matching spawnRegistryOp /
spawnRegistryPreset. Removes ~30 lines of duplicated gate logic; toast +
bail behaviour preserved by the regression tests added in the previous
commit.

Audit follow-up — H22.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Out of scope

- Renaming `_resolveSpawnContext` (underscore is module-private convention; keep).
- Changing the public signatures of `spawnToolWidget` / `spawnRegistryOp` / `spawnRegistryPreset`.
- Touching `_scopeForSpawn` — it's already shared and correct.
- Moving `_resolveSpawnContext` to a different file. It belongs with its only callers.

## Done when

- `git -C /Users/anton/Dev/Projects/editor log --oneline | head -2` shows the two commits.
- `npm run check` is green.
- A diff of `src/lib/toolrail-spawn.ts` against its pre-H22 state shows ~30 lines removed and `spawnToolWidget` reduced to ~10 lines.
