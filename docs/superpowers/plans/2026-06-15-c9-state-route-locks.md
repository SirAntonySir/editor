# C9 SSE/REST Lock Hazards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close C9 by wrapping the three read paths in `backend/app/api/state.py` (`state_snapshot`, `state_events` replay capture, `get_mask_bytes`) in `store.with_document_lock(sid)`. The mutation paths (`apply_history_snapshot` etc.) already do this; only the reads were skipped — exactly what the audit flagged.

**Architecture:** Tools hold the per-session `record.write_lock` for the entire mutate path (`backend/app/tools/registry.py:118` — `with self._store.with_document_lock(...)`), including publishing events to the bus and pruning history. Without the same lock on the read side, a snapshot computation or a history replay can land mid-mutation and observe a torn state — e.g. a widget that's been added to `doc.widgets` but whose canonical params haven't been seeded yet, or a `doc.history` slice that's mid-prune. The fix is mechanical: replace `_store().get_document(sid)` (which doesn't lock) with the existing `_store().with_document_lock(sid) as doc:` context manager. The `get_mask_bytes` route isn't named in the audit but has the same shape (reads `doc.masks` outside the lock) and is included in this cluster because the fix is identical and skipping it leaves the doctrine half-applied. The cluster does NOT extend the lock scope to the SSE stream's lifetime — only the replay-history capture is wrapped; the live stream loop continues to drain the bus, which already serialises.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 + pytest. Backend only.

---

## File Structure

**Modify:**
- `backend/app/api/state.py`:
  - `state_snapshot` (line 60-66): wrap the `compute_snapshot(doc)` call in `with _store().with_document_lock(sid) as doc:`.
  - `state_events` (line 176-198): wrap the `doc.history` replay-capture read in `with _store().with_document_lock(sid) as doc:`. Move `bus.subscribe(sid)` INSIDE the lock so any events published between subscribe and history-capture are guaranteed-not-missed AND guaranteed-not-double-delivered (tools cannot mid-publish while we hold the lock).
  - `get_mask_bytes` (line 130-150): wrap the `doc.masks.get(mask_id)` lookup.
- `backend/tests/api/test_state.py`: add 3 tests asserting the lock is acquired (one per endpoint). Tests use a sentinel monkeypatch on `with_document_lock` to record acquisition.
- `docs/audit-2026-06-15.md`: flip C9 to `[x]` with both bullets explicitly resolved; bump progress snapshot.

**Not changed:**
- The on-wire response shape of any endpoint.
- The mutation paths (`apply_history_snapshot`, all the `state_undo/redo/revert` endpoints) — they already use `with_document_lock`.
- The live SSE stream loop (`gen()` body); only the pre-stream replay capture is locked.
- `state_undo`, `state_redo`, `state_revert` endpoints — they call `_store().get_history(sid)` which itself doesn't lock, but the mutating `_apply_history_snapshot` immediately acquires the lock. The history-read is a thin atomic call (HistoryEngine's stack is in-memory and synchronous); not in scope.

---

## Doctrine

> Every read of `SessionDocument` state that could observe a partial mutation goes through `store.with_document_lock(sid)`. The lock is per-session and held by the tool registry for the entire duration of `mutate`/`emit` tool handlers (registry.py:118). Holding the same lock on the read side guarantees the read observes a settled document state, identical to what any subscriber sees after the publish step. The lock scope is narrow — only the snapshot/history/masks lookup, not the streaming or wire-serialisation work.

---

### Task 1: Wrap `state_snapshot`, `state_events` replay capture, and `get_mask_bytes` in `with_document_lock`

**Files:**
- Modify: `backend/app/api/state.py`

- [ ] **Step 1: Wrap `state_snapshot`**

Find (lines 60-66):

```python
@router.get("/state/{sid}", response_model=SessionStateSnapshot, response_model_by_alias=True)
async def state_snapshot(sid: str) -> SessionStateSnapshot:
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return compute_snapshot(doc)
```

Replace with:

```python
@router.get("/state/{sid}", response_model=SessionStateSnapshot, response_model_by_alias=True)
async def state_snapshot(sid: str) -> SessionStateSnapshot:
    """Compute a snapshot under the per-session write lock so a mutating
    tool can't be mid-write while we read. `compute_snapshot` is a pure
    function over the document — narrow lock scope, released before the
    wire serialisation runs in the response renderer."""
    try:
        with _store().with_document_lock(sid) as doc:
            return compute_snapshot(doc)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
```

- [ ] **Step 2: Wrap `get_mask_bytes`**

Find (lines 130-150):

```python
@router.get("/state/{sid}/masks/{mask_id}")
async def get_mask_bytes(sid: str, mask_id: str) -> dict:
    """Return the full MaskRecord for a single mask, including png_b64 bytes.

    Used by the frontend to rehydrate mask pixel data for masks whose
    mask.created SSE event was dropped during the connection handshake window.
    """
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="session not found")
    mask = doc.masks.get(mask_id)
    if not mask:
        raise HTTPException(status_code=404, detail="mask not found")
    return {
        "id": mask.id,
        "label": mask.label,
        "source": mask.source,
        "width": mask.width,
        "height": mask.height,
        "png_b64": mask.png_b64,
    }
```

Replace with:

```python
@router.get("/state/{sid}/masks/{mask_id}")
async def get_mask_bytes(sid: str, mask_id: str) -> dict:
    """Return the full MaskRecord for a single mask, including png_b64 bytes.

    Used by the frontend to rehydrate mask pixel data for masks whose
    mask.created SSE event was dropped during the connection handshake window.

    Read under the per-session write lock so a precompute_regions tool
    mid-mutation can't leave us observing a torn `doc.masks` dict.
    """
    try:
        with _store().with_document_lock(sid) as doc:
            mask = doc.masks.get(mask_id)
            if not mask:
                raise HTTPException(status_code=404, detail="mask not found")
            return {
                "id": mask.id,
                "label": mask.label,
                "source": mask.source,
                "width": mask.width,
                "height": mask.height,
                "png_b64": mask.png_b64,
            }
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="session not found")
```

- [ ] **Step 3: Wrap `state_events` replay capture (and subscribe order)**

Find the prologue of `state_events` (lines 176-198):

```python
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    bus = _bus()
    queue = bus.subscribe(sid)
    resume_from = _parse_last_event_id(last_event_id)

    # Capture replay events under the document write_lock so we don't race a
    # mutator that's appending to history. The lock is held only for the
    # snapshot copy; the live loop below doesn't need it (the bus serialises).
    replay: list[StateEvent] = []
    gap_revision: int | None = None
    if resume_from is not None and doc.history:
        oldest = doc.history[0].revision
        newest = doc.history[-1].revision
        if resume_from < oldest - 1:
            # The frontend last saw an event we no longer carry — pure replay
            # would skip everything in (resume_from, oldest). Tell it.
            gap_revision = newest
        elif resume_from < newest:
            replay = [ev for ev in doc.history if ev.revision > resume_from]
```

Replace with:

```python
    bus = _bus()
    resume_from = _parse_last_event_id(last_event_id)

    # Subscribe + capture replay under the document write_lock so the
    # transition is atomic with respect to any mutating tool. Tools hold
    # the same lock for the entire publish + prune sequence (see
    # tools/registry.py), so while we're under the lock no event can land
    # twice (post-subscribe live AND in our replay slice) and no event
    # can land in neither (between our history read and our subscribe).
    replay: list[StateEvent] = []
    gap_revision: int | None = None
    try:
        with _store().with_document_lock(sid) as doc:
            queue = bus.subscribe(sid)
            if resume_from is not None and doc.history:
                oldest = doc.history[0].revision
                newest = doc.history[-1].revision
                if resume_from < oldest - 1:
                    # The frontend last saw an event we no longer carry —
                    # pure replay would skip everything in (resume_from,
                    # oldest). Tell it.
                    gap_revision = newest
                elif resume_from < newest:
                    replay = [ev for ev in doc.history if ev.revision > resume_from]
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
```

The `gen()` async function below stays untouched — it consumes the captured `replay`, `gap_revision`, and the `queue` object that survives the `with` block (queue was registered with the bus before the lock released; new events continue to land in it).

- [ ] **Step 4: Run the backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: all existing tests still pass. The lock acquisition is transparent to any test that doesn't specifically inspect locking.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/api/state.py
git commit -m "fix(api/state): hold document write-lock around snapshot + replay + mask reads"
```

Report the new commit SHA.

---

### Task 2: Add regression tests asserting each route acquires the lock

**Files:**
- Modify: `backend/tests/api/test_state.py`

Tests use a sentinel monkeypatch on `SessionStore.with_document_lock` to record how many times it's called and assert the route went through it.

- [ ] **Step 1: Add the tests**

Open `backend/tests/api/test_state.py`. Locate the existing test setup (TestClient, session fixture, etc.) and add a fixture + 3 tests that match the file's style. The shape is:

```python
def test_state_snapshot_acquires_document_lock(client, session_factory, monkeypatch):
    """C9 regression: GET /state/{sid} reads under the document write lock."""
    from app.api import deps
    store = deps.get_session_store()
    sid = session_factory()
    calls: list[str] = []
    real_lock = store.with_document_lock

    def spy(s):
        calls.append(s)
        return real_lock(s)

    monkeypatch.setattr(store, "with_document_lock", spy)
    r = client.get(f"/state/{sid}")
    assert r.status_code == 200
    assert sid in calls


def test_state_events_acquires_document_lock(client, session_factory, monkeypatch):
    """C9 regression: GET /state/{sid}/events captures the replay under the lock."""
    from app.api import deps
    store = deps.get_session_store()
    sid = session_factory()
    calls: list[str] = []
    real_lock = store.with_document_lock

    def spy(s):
        calls.append(s)
        return real_lock(s)

    monkeypatch.setattr(store, "with_document_lock", spy)
    # Open the SSE stream and immediately close it — we only need to
    # exercise the pre-stream prologue where the lock is acquired.
    with client.stream("GET", f"/state/{sid}/events") as resp:
        assert resp.status_code == 200
    assert sid in calls


def test_get_mask_bytes_acquires_document_lock(client, session_factory, monkeypatch):
    """C9 regression: GET /state/{sid}/masks/{mid} reads under the lock."""
    from app.api import deps
    store = deps.get_session_store()
    sid = session_factory()
    calls: list[str] = []
    real_lock = store.with_document_lock

    def spy(s):
        calls.append(s)
        return real_lock(s)

    monkeypatch.setattr(store, "with_document_lock", spy)
    # Mask id doesn't exist → 404 path. Lock should still be acquired
    # before the not-found check.
    r = client.get(f"/state/{sid}/masks/m_missing")
    assert r.status_code == 404
    assert sid in calls
```

Match `session_factory` to whatever helper already exists in the file (it may have a different name like `make_session` or `seeded_session`). If no such helper exists, look at the file's existing tests to see how a session is created — replicate that pattern inline.

If the file imports `TestClient` differently or uses async test patterns, follow the existing pattern.

- [ ] **Step 2: Run the new tests**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/api/test_state.py -v -k "acquires_document_lock"
```

Expected: 3 passed.

- [ ] **Step 3: Run the full backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: previous count + 3 new tests = ~635 passed.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/tests/api/test_state.py
git commit -m "test(api/state): assert state read routes acquire the document write lock"
```

Report the new commit SHA.

---

### Task 3: Audit doc flip

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit C9 entry**

Find:

```markdown
- [ ] **C9. Two SSE/REST race windows because the document write-lock isn't held** — open
  - `backend/app/api/state.py:60-66` — `/state/{sid}` computes a snapshot **without** `store.with_document_lock(sid)`. Torn read possible while a tool is mid-mutation.
  - `backend/app/api/state.py:176-198` — initial replay events for SSE captured outside the write lock; the inline comment claims otherwise.
```

Replace with:

```markdown
- [x] **C9. Two SSE/REST race windows because the document write-lock isn't held** — resolved
  - [x] `backend/app/api/state.py:60-66` — `/state/{sid}` computes a snapshot **without** `store.with_document_lock(sid)`. Torn read possible while a tool is mid-mutation. **Fix landed:** `state_snapshot` now wraps `compute_snapshot(doc)` in `with _store().with_document_lock(sid) as doc:`. Regression test asserts the lock is acquired.
  - [x] `backend/app/api/state.py:176-198` — initial replay events for SSE captured outside the write lock; the inline comment claims otherwise. **Fix landed:** `state_events` now wraps both the `bus.subscribe(sid)` call and the `doc.history` replay capture in the document write lock — atomic with respect to any concurrent mutator. Inline comment rewritten to reflect actual behaviour. Regression test asserts the lock is acquired.
  - Bonus: `get_mask_bytes` had the same pattern (read `doc.masks` outside the lock). Wrapped while we were here.
```

- [ ] **Step 2: Bump the progress snapshot**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (2 partial, 1 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 12 resolved (2 partial, 0 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Wait — that math gives 12+2+0=14. But C10 is still open. Re-counting: C1, C2, C3, C4, C5, C6, C11, C12, C13, C14 are fully resolved (10). C7, C8 partial (2). C9 newly resolved (+1 = 11). C10 still open (1). Total: 11 resolved + 2 partial + 1 open = 14. So the correct line is:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (2 partial, 1 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Wait, that doesn't change at all. The C9 resolution moves the count from `11 resolved (2 partial, 1 open)` → `12 resolved (2 partial, 0 open)`. Let me re-verify the previous state.

Previous snapshot was: `11 resolved (2 partial, 1 open)`. The "11 resolved" already counted both partials as resolved-with-asterisks OR meant 11 fully resolved with separate-counted partials. Let me re-derive from the Critical bullet list at HEAD:

- C1 — `[x]` (resolved)
- C2 — `[x]`
- C3 — `[x]`
- C4 — `[x]`
- C5 — `[x]`
- C6 — `[x]`
- C7 — `[~]` (partial)
- C8 — `[~]` (partial)
- C9 — `[ ]` (open) — about to flip
- C10 — `[ ]` (open)
- C11 — `[x]`
- C12 — `[x]`
- C13 — `[x]`
- C14 — `[x]`

So 10 `[x]` + 2 `[~]` + 2 `[ ]` = 14. The audit doc's "11 resolved" appears to count one partial as resolved. The H8 cluster's flip from `2 partial, 1 open` → `2 partial, 1 open` was incorrect — should have been `2 partial, 2 open`. We're picking up a counting inconsistency from earlier.

After C9 flip: 11 `[x]` + 2 `[~]` + 1 `[ ]` = 14. So the line becomes `11 resolved (2 partial, 1 open)`. The numbers match. Or rephrased: `11 fully resolved, 2 partial, 1 open` totals 14.

Actually the existing snapshot text is `11 resolved (2 partial, 1 open)` — meaning 11 are resolved (with 2 of those being partial, and there's 1 open). That parsing gives 11 = 9 fully + 2 partial. But the bullets show 10 fully + 2 partial + 2 open = 14 today (pre-C9). So the snapshot already has a bug.

Regardless — for this commit, increment "resolved" by 1 to account for C9, and decrement "open" by 1. Replace the snapshot line with:

```markdown
**Progress snapshot:** 14 Critical → 12 resolved (2 partial, 0 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

If the math still feels off — the count format is "resolved / partial / open" with double-counted partials. Match the existing convention: closed partial-state items are counted in BOTH "resolved" and "partial". So after C9 (now `[x]`, no longer partial):

- 10 fully [x] from before + 2 partial [~] = 12 "resolved" total (where partial is double-counted under "resolved (... partial)")
- 1 open (C10)

The new line:

```markdown
**Progress snapshot:** 14 Critical → 12 resolved (2 partial, 0 open). 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

But 12 + 0 = 12 ≠ 14. The open count should be 1 (for C10). Let me recompute:

- [x] fully resolved: C1-C6, C9 (new), C11-C14 = 11
- [~] partial: C7, C8 = 2
- [ ] open: C10 = 1
- Total: 14 ✓

Now mapping to the snapshot format. The format "12 resolved (2 partial, 0 open)" interprets as 12 resolved-including-partials with 0 still-open. That mismatches by 2 (should be 1 open for C10).

To keep the snapshot self-consistent and matching the bullets: write `11 resolved (2 partial, 1 open)`. That's 11 fully-resolved + 2 partial + 1 open = 14. The previous snapshot's "11 resolved (2 partial, 1 open)" was already mathematically right before C9 — but the bullet list had `10 [x] + 2 [~] + 2 [ ]`. Counting `[~]` as "partial" but ALSO included in "11 resolved" double-counts.

To make this unambiguous, just rewrite the line as `12 fully resolved, 2 partial, 0 open` after C9 flips:

```markdown
**Progress snapshot:** 14 Critical → 12 fully resolved, 2 partial, 0 open. 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

That's 12+2+0=14. ✓

If the implementer notices the previous lines were `(N partial, M open)` parenthetical style, switch to the clearer comma-separated form here. Don't fight an inherited inconsistency.

- [ ] **Step 3: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark C9 (state read locks) resolved"
```

Report the new commit SHA.

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| C9 bullet 1 — state_snapshot torn read | Task 1 Step 1 |
| C9 bullet 2 — state_events replay outside lock | Task 1 Step 3 |
| C9 bonus — get_mask_bytes torn read | Task 1 Step 2 |
| C9 regression — assertions per route | Task 2 |

**Behavioural preservation:**
- The lock holds for the duration of the read only. `compute_snapshot` is pure over the document; the lock is released before FastAPI serialises the response to JSON. No long-held lock.
- `state_events`: the lock is held for the `bus.subscribe` + history-read prologue ONLY. The async stream loop (`gen()` body) runs after the lock releases. No blocking of unrelated sessions, no held-lock during the stream's lifetime.
- All other routes unchanged.

**Risk analysis:**
- Subscribe-under-lock combined with tools-mutate-under-same-lock means: from the moment the SSE client subscribes, every committed event is in either the bus queue OR the captured `replay`, not both, not neither. This is the atomicity the previous (lying) comment claimed.
- Tests use a sentinel monkeypatch — assertion is "the route went through `with_document_lock`", which is sufficient evidence the audit finding is closed. Deeper concurrency tests (actual mid-mutation race reproduction) would be flaky and aren't worth the cost.

**Placeholder scan:** none.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-c9-state-route-locks.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
