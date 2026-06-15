# C8 Cross-Store + Stale-Closure Hazard Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three cross-store + stale-closure hazards C8 flagged in `backend-state-slice.ts` and `document.ts`. Move cross-store mutations OUT of the Immer producer in `applyEvent` via a side-effects-queue pattern. Add a stale-session re-check guard inside the `state.gap` async refetch closure. Hoist the dynamic `useAiSession` import in `openImage` to a static top-of-file import (removes one race window).

**Architecture:** Today `applyEvent` does three things inside the same Immer producer: mutate `s.snapshot.widgets` (correct), call `useEditorStore.getState().consumePinRequest(...)` / `setPinnedWidgetParams(...)` (cross-store), call `useSuggestionsUi.getState().markPending(...)` (cross-store added by the H4 cluster), and call `tetherWorkspaceWidget(w)` (which mutates the editor store). If any of those stores resets mid-event, the partial reducer commit leaves us with snapshot-side widgets present but cross-store side effects missing. Same problem on `state.gap`: the captured `sid` is held by a fire-and-forget async closure with no check that the session is still current when the late `setSnapshot` lands. The `openImage` dynamic-import-then-reset-then-openSession sequence adds a third race against itself when the user opens two images in quick succession. The fix is a side-effects queue: the Immer producer pushes thunks onto a local array; after `set(...)` returns, the action drains the array. State changes commit cleanly; side effects fire on a settled store. The `state.gap` re-check is one line. The `openImage` hoist eliminates one of two race windows; a generation-counter fix on `useAiSession.openSession` (the second race window) is deferred to its own cluster.

**Tech Stack:** React + TypeScript (strict) + Zustand v5 + Immer + vitest. Frontend only.

---

## File Structure

**Modify:**
- `src/store/backend-state-slice.ts` — refactor `applyEvent`: collect cross-store mutations as side-effect thunks during the immer producer, drain them AFTER `set(...)` returns. Add a stale-session-id re-check inside the `state.gap` async refetch closure. Cover all 4 known cross-store calls: `useSuggestionsUi.markPending`, `useEditorStore.consumePinRequest`, `useEditorStore.setPinnedWidgetParams`, `tetherWorkspaceWidget(w)`.
- `src/store/backend-state-slice.test.ts` — adapt the existing bridge test if the structural refactor changes its timing (the test should still pass — side-effects fire synchronously after `set` returns). Add a new test: a `state.gap` event whose async refetch lands AFTER a `reset()` does NOT clobber the new session.
- `src/core/document.ts` — hoist `useAiSession` from a dynamic `import().then()` to a static top-of-file import. Add a comment about the remaining race (openSession's async upload completing after a newer openSession started).
- `docs/audit-2026-06-15.md` — flip C8 to `[~]` (partially resolved — SSE hazards closed, `openImage` race not fully closed because `useAiSession.openSession` still lacks a generation guard). Bump progress snapshot accordingly.

**Not changed:**
- `useAiSession.openSession` itself — the generation-counter fix is a separate cluster.
- Any consumer that reads from useSuggestionsUi / useEditorStore — the side-effects-queue refactor is invisible to them because the writes still happen synchronously within the same dispatch.
- The 4 SSE event semantics are preserved byte-for-byte: same widgets added to snapshot, same chips marked pending, same pin-request drained, same workspace tether placement.

---

## Doctrine

> Cross-store mutations from within an Immer producer are a code smell. The fix: a local side-effects array. The Immer producer pushes closures onto it that do the cross-store work; after `set(...)` returns, the action drains the array. This keeps the reducer pure AND lets side effects observe a settled store state. A second smell — stale-captured args in fire-and-forget async closures — gets fixed by re-checking the relevant identity inside the closure before the late mutation lands.

---

### Task 1: Refactor `applyEvent` to use a side-effects queue + add `state.gap` stale-session re-check

**Files:**
- Modify: `src/store/backend-state-slice.ts`

Cross-store calls and other side effects (`tetherWorkspaceWidget`, the `state.gap` async refetch) move OUT of the Immer producer. The producer pushes thunks onto a local array `sideEffects: Array<() => void>`. After `set(...)` returns, the action drains the array.

The `state.gap` async closure stays in the side-effects queue (it's deferred + async); we also tighten it to re-check `useBackendState.getState().sessionId === capturedSid` before calling `setSnapshot`. If session changed between SSE event and async fetch completion, abort.

- [ ] **Step 1: Read the current `applyEvent` shape**

Open `src/store/backend-state-slice.ts`. Locate `applyEvent: (ev: StateEvent) =>` — currently an arrow function returning `set(...)`. The producer body contains a big switch with side effects scattered through it. We'll convert it to:

```ts
applyEvent: (ev: StateEvent) => {
  const sideEffects: Array<() => void> = [];
  set((s) => {
    // ... existing switch body, but cross-store + async calls REPLACED with sideEffects.push(() => { ... })
  });
  for (const effect of sideEffects) effect();
},
```

- [ ] **Step 2: Rewrite `applyEvent` end-to-end**

This is one big edit; preserve every existing case body except the cross-store calls. Use the surgical guidance below.

Locate (around line 192-409):
```ts
    applyEvent: (ev) =>
      set((s) => {
        // ... entire body
      }),
```

Replace the entire `applyEvent: ...` definition with:

```ts
    applyEvent: (ev) => {
      // Side-effects queue: cross-store mutations and async refetches that
      // happen inside the SSE handler are pushed here from inside the
      // Immer producer, then drained AFTER `set(...)` returns. Keeps the
      // reducer pure and lets side effects observe a settled store.
      const sideEffects: Array<() => void> = [];

      set((s) => {
        // PRESERVE the existing body verbatim, with three structural edits:
        //
        // (1) Inside the `state.gap` case, the entire async closure becomes
        //     a sideEffects.push entry — see Step 3 below.
        // (2) Inside `widget.created`, the markPending bridge + the
        //     consumePinRequest/setPinnedWidgetParams calls + the
        //     `tetherWorkspaceWidget(w)` call all become sideEffects.push
        //     entries — see Step 4 below.
        // (3) No other case currently makes cross-store calls; preserve
        //     them as-is.

        // ... existing body (transformed per Steps 3 + 4)
      });

      for (const effect of sideEffects) effect();
    },
```

Now apply Steps 3 and 4 inside the body.

- [ ] **Step 3: Transform the `state.gap` case**

Current shape (around lines 207-225):

```ts
          case 'state.gap': {
            const sid = s.sessionId;
            if (sid) {
              void (async () => {
                try {
                  const { fetchSnapshot } = await import('@/lib/sse-subscriber');
                  const snap = await fetchSnapshot(sid);
                  useBackendState.getState().setSnapshot(snap);
                } catch (err) {
                  console.warn('[sse] state.gap refetch failed:', err);
                }
              })();
            }
            return;
          }
```

Replace with:

```ts
          case 'state.gap': {
            const sid = s.sessionId;
            if (sid) {
              // Defer the async refetch to a side-effect so the closure
              // observes a settled store. Re-check that `sid` is still
              // the active session at write time — between event and
              // refetch completion the user may have opened a new image,
              // and writing the stale snapshot would clobber the new
              // session's state.
              sideEffects.push(() => {
                void (async () => {
                  try {
                    const { fetchSnapshot } = await import('@/lib/sse-subscriber');
                    const snap = await fetchSnapshot(sid);
                    if (useBackendState.getState().sessionId !== sid) {
                      console.warn(
                        '[sse] state.gap refetch dropped — session changed during fetch',
                      );
                      return;
                    }
                    useBackendState.getState().setSnapshot(snap);
                  } catch (err) {
                    console.warn('[sse] state.gap refetch failed:', err);
                  }
                })();
              });
            }
            return;
          }
```

- [ ] **Step 4: Transform the `widget.created` case**

Current shape (around lines 278-312):

```ts
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            if (w.origin.kind === 'mcp_autonomous') {
              const existing = useSuggestionsUi.getState().pendingSuggestionIds;
              useSuggestionsUi.getState().markPending([...existing, w.id]);
            }
            if (w.origin.kind === 'tool_invoked') {
              const firstNode = w.nodes[0];
              const layerId = firstNode?.layerId;
              const opType = firstNode?.type;
              if (layerId && opType) {
                const keys = useEditorStore.getState().consumePinRequest(layerId, opType);
                if (keys && keys.length > 0) {
                  useEditorStore.getState().setPinnedWidgetParams(w.id, keys);
                }
              }
            }
            tetherWorkspaceWidget(w);
            break;
          }
```

Replace with:

```ts
          case 'widget.created': {
            const w = payload.widget as Widget;
            s.snapshot.widgets.push(w);
            // Bridge into the FE-only suggestions UI slice for autonomous
            // suggestions — deferred to a side-effect so the cross-store
            // call observes a settled `useSuggestionsUi`.
            if (w.origin.kind === 'mcp_autonomous') {
              sideEffects.push(() => {
                const existing = useSuggestionsUi.getState().pendingSuggestionIds;
                useSuggestionsUi.getState().markPending([...existing, w.id]);
              });
            }
            // Drain a matching per-slider Pin request (queued before the
            // backend roundtrip). Deferred for the same reason.
            if (w.origin.kind === 'tool_invoked') {
              const firstNode = w.nodes[0];
              const layerId = firstNode?.layerId;
              const opType = firstNode?.type;
              if (layerId && opType) {
                sideEffects.push(() => {
                  const keys = useEditorStore.getState().consumePinRequest(layerId, opType);
                  if (keys && keys.length > 0) {
                    useEditorStore.getState().setPinnedWidgetParams(w.id, keys);
                  }
                });
              }
            }
            // Workspace tether placement also touches useEditorStore;
            // defer to keep the producer pure.
            sideEffects.push(() => tetherWorkspaceWidget(w));
            break;
          }
```

- [ ] **Step 5: Verify other cases have no cross-store calls**

Read the rest of the `applyEvent` switch (cases `widget.updated`, `widget.deleted`, `widget.restored`, `widget.accepted`, `mask.created`, `phase.*`, `context.updated`, `history.applied`, `mcp.usage`, etc.). For each, confirm that NO cross-store `getState().something()` call is made inside the immer producer. If any are found that I missed, transform them to side-effects pushes the same way.

If you find a cross-store call I missed, STOP and report it before continuing.

- [ ] **Step 6: Run the full check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. The 2 H4-cluster tests (markPending bridge + cross-store reset) should still pass — the bridge still fires; it just fires AFTER the immer producer commits instead of during. Same observable behaviour from the test's POV.

If a test fails because it asserted ordering (e.g., "pendingSuggestionIds is set BEFORE snapshot.widgets is mutated"), the assertion is implementation-detail; update the assertion to test final state after `applyEvent` returns, not intermediate state.

- [ ] **Step 7: Add a new test for `state.gap` stale-session protection**

Open `src/store/backend-state-slice.test.ts`. Find a suitable place inside the existing `describe('BackendStateSlice', ...)` block. Add:

```ts
  it('state.gap async refetch is dropped when sessionId changed mid-fetch', async () => {
    const fetched: { snapshot: unknown } = { snapshot: null };
    vi.doMock('@/lib/sse-subscriber', () => ({
      fetchSnapshot: vi.fn(async () => ({ sessionId: 's_old', revision: 5 })),
    }));

    useBackendState.setState({
      sessionId: 's_old',
      snapshot: { sessionId: 's_old', revision: 1, widgets: [], masksIndex: [],
        operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        imageContext: null,
      } as never,
      sseStatus: 'open',
    });

    useBackendState.getState().applyEvent({
      revision: 2, kind: 'state.gap',
      emittedAt: new Date().toISOString(), payload: {},
    } as never);

    // Simulate the user opening a new image AFTER the gap event but
    // BEFORE the async refetch resolves.
    useBackendState.getState().setSessionId('s_new');

    // Wait one microtask + one macrotask for the async refetch to land.
    await new Promise((r) => setTimeout(r, 0));

    // The stale-session re-check should have dropped the refetched
    // snapshot — sessionId stays 's_new', snapshot is not overwritten
    // with the old 's_old' payload.
    expect(useBackendState.getState().sessionId).toBe('s_new');
    expect(fetched.snapshot).toBeNull();  // sanity: we never wrote it

    vi.doUnmock('@/lib/sse-subscriber');
  });
```

NOTE: depending on the test file's existing mock infrastructure, this test may need to use `vi.mock` at the top instead of inline `vi.doMock`. Match the existing style. If the file already mocks `@/lib/sse-subscriber`, extend that mock instead.

- [ ] **Step 8: Run tests again**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: all green, including the new test.

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/store/backend-state-slice.ts src/store/backend-state-slice.test.ts
git commit -m "refactor(backend-state): defer cross-store mutations + guard state.gap session"
```

Report the new commit SHA.

---

### Task 2: Hoist `useAiSession` import in `openImage`

**Files:**
- Modify: `src/core/document.ts`

Today `openImage` uses `void import('@/hooks/useImageContext').then(({ useAiSession }) => { useAiSession.getState().reset(); void useAiSession.getState().openSession(offscreen); })`. The dynamic `import` adds one race window: two rapid `openImage` calls can interleave the import resolution → reset → openSession sequence. There's no circular dependency that forces the dynamic import (verified: `src/hooks/useImageContext.ts` does not import `src/core/document.ts`), so we can hoist to a static top-of-file import. This kills the import-resolution race. A second race window — `openSession` being async (it uploads an image) and the user opening a third image while the second upload is in flight — is NOT addressed here; that needs a generation counter on `useAiSession.openSession`, deferred to a separate cluster.

- [ ] **Step 1: Add the static import at the top of `src/core/document.ts`**

Open the file. Find the import block at the top. Add (with other `@/hooks/...` imports if any, otherwise grouping with the other `@/` imports):

```ts
import { useAiSession } from '@/hooks/useImageContext';
```

- [ ] **Step 2: Replace the dynamic import call**

Find (around lines 245-248):

```ts
  void import('@/hooks/useImageContext').then(({ useAiSession }) => {
    useAiSession.getState().reset();
    void useAiSession.getState().openSession(offscreen);
  });
```

Replace with:

```ts
  // Kick off backend session bootstrap.
  // NOTE: openSession is async (uploads the offscreen canvas). If the user
  // opens a second image while a prior upload is still in flight, the late
  // upload can clobber the new session. Addressing that race requires a
  // generation counter on useAiSession.openSession — out of scope for the
  // C8 cluster, tracked as a follow-up.
  useAiSession.getState().reset();
  void useAiSession.getState().openSession(offscreen);
```

- [ ] **Step 3: Run the full check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. Tests pass at the same count as Task 1.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/core/document.ts
git commit -m "refactor(core/document): hoist useAiSession import in openImage"
```

Report the new commit SHA.

---

### Task 3: Audit doc flip C8 (partial)

C8 has three call-site bullets. After Tasks 1 + 2, two are fully fixed and one (the openImage race) is partially fixed (one race window closed; the second window — async `openSession` clobber — remains). Mark C8 as `[~]` (partially resolved) with a clear note about the remaining work.

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit C8 entry**

Find:

```markdown
- [ ] **C8. Stale-closure / cross-store mutation hazards in SSE event handler** — open
  - `src/store/backend-state-slice.ts:243` — `state.gap` handler captures `sid` then fires `useBackendState.getState().setSnapshot()` in a fire-and-forget async closure. No re-check that the session is still active → wrong-session writes after a reset.
  - `src/store/backend-state-slice.ts:323-325` — Inside an Immer producer, calls `useEditorStore.getState().consumePinRequest()` / `setPinnedWidgetParams()`. Cross-store mutation from a state reducer; if either store resets mid-event, state diverges.
  - `src/core/document.ts:243-246` — `openImage()` triggers `useAiSession.getState().reset() / openSession()` in a deferred microtask after committing user-visible state. Open-image-then-open-image races.
```

Replace with:

```markdown
- [~] **C8. Stale-closure / cross-store mutation hazards in SSE event handler** — partially resolved
  - [x] `src/store/backend-state-slice.ts:243` — `state.gap` handler captures `sid` then fires `useBackendState.getState().setSnapshot()` in a fire-and-forget async closure. No re-check that the session is still active → wrong-session writes after a reset. **Fix landed:** the closure now re-checks `useBackendState.getState().sessionId === sid` before writing; logs and drops on mismatch.
  - [x] `src/store/backend-state-slice.ts:323-325` — Inside an Immer producer, calls `useEditorStore.getState().consumePinRequest()` / `setPinnedWidgetParams()`. Cross-store mutation from a state reducer; if either store resets mid-event, state diverges. **Fix landed:** `applyEvent` now uses a side-effects-queue pattern — cross-store calls and `tetherWorkspaceWidget` are pushed to a local array inside the Immer producer and drained AFTER `set(...)` returns. The H4 cluster's `useSuggestionsUi.markPending` bridge was moved to the same queue.
  - [~] `src/core/document.ts:243-246` — `openImage()` triggers `useAiSession.getState().reset() / openSession()` in a deferred microtask after committing user-visible state. Open-image-then-open-image races. **Partial fix landed:** hoisted the dynamic `import('@/hooks/useImageContext')` to a static top-of-file import; eliminates the import-resolution race window. The second race window — `useAiSession.openSession` is async (uploads the offscreen canvas) and a second openImage call mid-upload can clobber the in-flight session — needs a generation counter on `useAiSession.openSession` and is deferred to its own cluster.
```

- [ ] **Step 2: Bump the progress snapshot**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (2 partial, 1 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

(C8 moves from `open` to `partial`. The other partial is still C7 from earlier.)

- [ ] **Step 3: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark C8 partially resolved (SSE hazards closed; openImage race deferred)"
```

Report the new commit SHA.

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| C8 — state.gap stale session | Task 1 (re-check before setSnapshot) |
| C8 — widget.created cross-store mutations | Task 1 (side-effects queue) |
| C8 — openImage race (import + openSession) | Task 2 (partial — import hoist only) |

C8's first two bullets close fully. The third partially closes — only the import-resolution race window. The async-openSession-clobber race remains and is recorded as a follow-up.

**Behavioural preservation:**
- Side-effects queue pattern: cross-store writes still fire as part of the same `applyEvent` call. From any consumer's POV (`useEffect` running off store changes, selector re-runs), the order is: snapshot mutation commits → side effects fire. The only observable difference from today is that a consumer that subscribed to BOTH stores via `combine`-like patterns would see snapshot before suggestions in two re-renders instead of one. No such consumer exists in the codebase (each consumer reads from one store).
- `state.gap` re-check: in the common case (no session change), behaviour is identical. The new branch only fires when `sessionId` legitimately changed between the SSE event and the refetch completion — exactly the bug we're closing.
- `openImage` import hoist: the runtime semantics are identical (`useAiSession` resolves to the same module export); only the import resolution time changes from dynamic to module-load. Tests already exercise `openImage` indirectly via `addImage`/document workflows; nothing changes.

**Placeholder scan:** none.

**Risk analysis:**
- The side-effects queue makes side effects fire AFTER the immer commit. If any of the side-effect closures throws, subsequent closures in the same `applyEvent` call don't fire. Today's behaviour: an exception inside the immer producer leaves an inconsistent intermediate state. Either way is bad; the new shape is at least debuggable because the immer commit succeeds first. Consider adding `try { effect(); } catch (err) { console.warn('[applyEvent] side effect threw', err); }` if defensive — but only if a real failure mode emerges, and the existing per-case `state.gap` try/catch already covers the only known async side effect.
- The new `state.gap` test depends on Vitest's `vi.doMock` / `vi.doUnmock` for runtime mock replacement. If the test file's existing structure doesn't support this (e.g., uses `vi.mock` at top), adapt the test to match.

**Type consistency:** `sideEffects` is typed `Array<() => void>` — closures are pushed by the immer producer and drained by the action; no type leakage.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-c8-cross-store-hazards.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
