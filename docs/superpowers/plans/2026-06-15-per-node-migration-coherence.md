# Per-Node Migration Coherence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the half-done singleton→per-image-node migration so persistence stays bounded, undo restores per-node analysis context, and the doctrine is one-direction (per-node only).

**Architecture:** Today the `SessionDocument` carries BOTH the legacy singletons (`image_bytes` / `mime_type` / `image_context` / `prepare_result`) AND per-node dicts. Recent commits added the per-node accessors with a "fall back to singleton" rule for `in-default`, but bootstrap writers still update *both* sides. Persistence excludes only the singletons, so multi-image sessions balloon the JSON; `Snapshot.capture` excludes both sides, so undo wipes per-node `image_context`. This plan locks in: new code only writes per-node; the singletons become a one-shot revive promotion target; persistence excludes anything image-bytes-shaped on either side; `image_context_by_node` is captured in snapshots; `prepare_result_by_node` is regenerable and stays out of persistence/snapshots; revive rehydrates per-node bytes from disk.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 / pytest. All backend.

---

## File Structure

**Modify:**
- `backend/app/state/document.py` — add `_promote_singletons_to_per_node()`; comment the doctrine; (no schema removal — backwards-compat with v1 persisted docs).
- `backend/app/tools/atomic/analyze_context.py` — stop writing `doc.image_context = enriched`; per-node only.
- `backend/app/tools/atomic/precompute_regions.py` — stop writing `doc.image_context = new_ctx`; per-node only.
- `backend/app/tools/atomic/prepare_image.py` — stop writing `doc.prepare_result = pr`; per-node only.
- `backend/app/api/session.py` — stop writing `doc.image_context = body`; per-node only.
- `backend/app/session/persistence.py` — extend `_EXCLUDE_FROM_PERSIST` with `image_bytes_by_node`, `prepare_result_by_node`; include `image_context_by_node` + `mime_type_by_node` (already implicit but documented).
- `backend/app/session/history.py` — capture `image_context_by_node` in `Snapshot`; update the doctrine docstring.
- `backend/app/state/document.py:apply_snapshot` — restore `image_context_by_node` AND clear the legacy `image_context` singleton (so a post-undo doc is per-node-clean).
- `backend/app/session/revive.py` — invoke `doc._promote_singletons_to_per_node()`; restore `image_bytes_by_node` entries from disk via a new `disk_session_io.read_per_node_images()`.
- `backend/app/services/disk_session_io.py` — add `read_per_node_images(sid) -> dict[image_node_id, (bytes, mime)]`.

**Create (tests):**
- `backend/tests/state/test_promote_singletons.py` — promotion helper unit tests.
- `backend/tests/session/test_persistence_per_node.py` — round-trip + exclusion tests.
- `backend/tests/session/test_revive_per_node.py` — multi-node revive end-to-end.
- `backend/tests/session/test_history_per_node.py` — `image_context_by_node` survives undo/redo/revert.

**Not changed:**
- Frontend — the per-node migration is backend-only. The on-wire snapshot shape is unchanged (`imageContext` field still present; per-node dict isn't sent to the FE).
- `disk_session_io.SCHEMA_VERSION` / `_schema_version` — same on-disk shape; older payloads parse fine because the per-node dicts default to `{}`.

---

## Doctrine — write this comment once, reference it from every touched file

> Per-image-node addressing is **the** canonical storage.
> The legacy `image_bytes` / `mime_type` / `image_context` / `prepare_result` singleton fields exist solely to load older persisted documents and are emptied on revive by `_promote_singletons_to_per_node()`. New code MUST write through `set_image_*(image_node_id, …)` / `set_image_context(image_node_id, …)` / `set_prepare_result(image_node_id, …)` and read through `get_*(image_node_id)`. `prepare_result_by_node` is regenerable from `image_bytes_by_node` via `PrepareImageTool`; it is intentionally not persisted and not snapshotted.

---

### Task 1: `_promote_singletons_to_per_node()` on `SessionDocument`

A one-shot helper that runs on revive (and is idempotent so test setup can call it). Moves any legacy singleton-only data into the `in-default` slot, clears the singleton, leaves data alone when both sides are populated (per-node wins — that's the intentional latest-write).

**Files:**
- Modify: `backend/app/state/document.py`
- Test: `backend/tests/state/test_promote_singletons.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/state/test_promote_singletons.py`:

```python
"""_promote_singletons_to_per_node — one-shot migration of legacy singletons
into the per-image-node dicts. Idempotent. Runs on revive so freshly-loaded
v1 documents converge to the per-node-only doctrine."""

from app.schemas.image_context import ImageContext
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["mid"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_promotes_legacy_image_bytes_into_in_default():
    doc = SessionDocument(session_id="s1", image_bytes=b"LEGACY", mime_type="image/png")
    doc._promote_singletons_to_per_node()
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"LEGACY"
    assert doc.mime_type_by_node[DEFAULT_IMAGE_NODE_ID] == "image/png"
    assert doc.image_bytes == b""
    assert doc.mime_type == "image/jpeg"  # neutral default after clear


def test_promotes_legacy_image_context_into_in_default():
    ctx = _ctx()
    doc = SessionDocument(session_id="s1", image_context=ctx)
    doc._promote_singletons_to_per_node()
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is ctx
    assert doc.image_context is None


def test_promotes_legacy_prepare_result_into_in_default():
    sentinel = object()
    doc = SessionDocument(session_id="s1")
    doc.prepare_result = sentinel
    doc._promote_singletons_to_per_node()
    assert doc.prepare_result_by_node[DEFAULT_IMAGE_NODE_ID] is sentinel
    assert doc.prepare_result is None


def test_per_node_wins_when_both_populated():
    """If a writer already moved to per-node-only AND a legacy singleton is
    still present (e.g. a halfway-migrated payload), the per-node entry is
    the source of truth and the singleton is just cleared."""
    legacy_ctx = _ctx()
    fresh_ctx = ImageContext(
        subjects=["fresh"], lighting="flat", dominant_tones=["mid"], mood="bright",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )
    doc = SessionDocument(session_id="s1", image_context=legacy_ctx)
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, fresh_ctx)
    doc._promote_singletons_to_per_node()
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is fresh_ctx
    assert doc.image_context is None


def test_no_op_on_fully_per_node_doc():
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, b"X", mime_type="image/png")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx())
    doc._promote_singletons_to_per_node()
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"X"
    assert doc.image_bytes == b""


def test_idempotent():
    doc = SessionDocument(session_id="s1", image_bytes=b"X", mime_type="image/png")
    doc._promote_singletons_to_per_node()
    doc._promote_singletons_to_per_node()  # second call is a no-op
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"X"
    assert doc.image_bytes == b""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/state/test_promote_singletons.py -v`
Expected: ALL FAIL with `AttributeError: 'SessionDocument' object has no attribute '_promote_singletons_to_per_node'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/app/state/document.py`, append a method on `SessionDocument` directly after the per-image-node accessors block (after `get_prepare_result`, around line 384):

```python
    def _promote_singletons_to_per_node(self) -> None:
        """One-shot migration: lift any legacy singleton image-data into the
        `in-default` per-image-node slot and clear the singleton. Idempotent.

        Called by revive after model_validate. The per-image-node dicts are
        the canonical storage; the singleton fields exist only to load older
        persisted documents written before this migration landed.

        Rule when both sides are populated: per-node wins (it was the more
        recent write); the singleton is just cleared. See the docstring
        block at the top of this section for the full doctrine.
        """
        # image_bytes / mime_type
        if self.image_bytes and DEFAULT_IMAGE_NODE_ID not in self.image_bytes_by_node:
            self.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] = self.image_bytes
            self.mime_type_by_node[DEFAULT_IMAGE_NODE_ID] = self.mime_type
        self.image_bytes = b""
        self.mime_type = "image/jpeg"

        # image_context
        if self.image_context is not None and DEFAULT_IMAGE_NODE_ID not in self.image_context_by_node:
            self.image_context_by_node[DEFAULT_IMAGE_NODE_ID] = self.image_context
        self.image_context = None

        # prepare_result
        if self.prepare_result is not None and DEFAULT_IMAGE_NODE_ID not in self.prepare_result_by_node:
            self.prepare_result_by_node[DEFAULT_IMAGE_NODE_ID] = self.prepare_result
        self.prepare_result = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/state/test_promote_singletons.py -v`
Expected: 6 passed.

- [ ] **Step 5: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green (603 + 6 new = 609).

- [ ] **Step 6: Commit**

```bash
git add backend/app/state/document.py backend/tests/state/test_promote_singletons.py
git commit -m "feat(state): add _promote_singletons_to_per_node migration helper"
```

---

### Task 2: Bootstrap writers stop touching the legacy singletons

Four call sites still write both sides during transition. After Task 1 the per-node path is the SSoT, so the singleton writes are dead weight that re-populate fields we want to leave empty.

**Files:**
- Modify: `backend/app/tools/atomic/analyze_context.py:121`
- Modify: `backend/app/tools/atomic/precompute_regions.py:76`
- Modify: `backend/app/tools/atomic/prepare_image.py:84`
- Modify: `backend/app/api/session.py:114`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/state/test_writers_per_node_only.py`:

```python
"""After the migration, bootstrap writers must NOT touch the legacy
singleton fields on SessionDocument. The per-image-node dicts are the
only canonical storage."""

from app.schemas.image_context import ImageContext
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["mid"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_api_session_context_endpoint_writes_per_node_only(monkeypatch):
    """POST /session/{sid}/context must populate image_context_by_node and
    leave doc.image_context untouched."""
    from app.api.session import set_session_context
    from app.services.session_store import SessionStore

    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"X", mime_type="image/jpeg")
    doc_before = store.get_document(sid)
    assert doc_before.image_context is None

    import asyncio
    asyncio.run(set_session_context(sid, _ctx(), store=store))

    doc = store.get_document(sid)
    assert doc.image_context is None, "writer must not touch the legacy singleton"
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/state/test_writers_per_node_only.py -v`
Expected: FAIL — `doc.image_context` is set by `api/session.py:114`.

- [ ] **Step 3: Edit `backend/app/tools/atomic/analyze_context.py`** — remove the singleton write at line 121:

```python
        enriched = build_enriched(base_ctx, pr.cheap, soft, region_stats)
        doc.set_image_context(DEFAULT_IMAGE_NODE_ID, enriched)
        deps.get_session_store().set_context(
            doc.session_id, enriched.model_dump(mode="json", by_alias=True),
        )
```

(Delete the `doc.image_context = enriched` line. The `doc.set_image_context(...)` line below it stays.)

- [ ] **Step 4: Edit `backend/app/tools/atomic/precompute_regions.py`** — remove the singleton write at line 76:

```python
        # Apply masks onto candidate_regions via model_copy (no mutation).
        new_ctx = apply_region_masks(ctx, live)
        doc.set_image_context(DEFAULT_IMAGE_NODE_ID, new_ctx)
        deps.get_session_store().set_context(
            doc.session_id, new_ctx.model_dump(mode="json", by_alias=True),
        )
```

(Delete the `doc.image_context = new_ctx` line.)

- [ ] **Step 5: Edit `backend/app/tools/atomic/prepare_image.py`** — remove the singleton write at line 84:

```python
        pr = PrepareResult(
            cheap=cheap, sam_ok=sam_ok, image_width=w_img, image_height=h_img,
        )
        doc.set_prepare_result(DEFAULT_IMAGE_NODE_ID, pr)
        return _Output(
            sam_ok=sam_ok, image_width=w_img, image_height=h_img, cheap=cheap,
        )
```

(Delete `doc.prepare_result = pr`.)

- [ ] **Step 6: Edit `backend/app/api/session.py`** — remove the singleton write at line 114:

```python
    try:
        store.set_context(sid, body.model_dump(mode="json", by_alias=True))
        # Per-image-node-only doctrine: set_context above persists to disk for
        # legacy callers; the typed model goes on the per-node dict so tools
        # can read it directly via doc.get_image_context(image_node_id).
        doc = store.get_document(sid)
        doc.set_image_context(DEFAULT_IMAGE_NODE_ID, body)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
```

(Delete `doc.image_context = body`.)

- [ ] **Step 7: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/state/test_writers_per_node_only.py -v`
Expected: PASS.

- [ ] **Step 8: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green. Tools that read via `get_image_context(DEFAULT_IMAGE_NODE_ID)` continue to work because the per-node write is still in place.

- [ ] **Step 9: Commit**

```bash
git add backend/app/tools/atomic/analyze_context.py \
        backend/app/tools/atomic/precompute_regions.py \
        backend/app/tools/atomic/prepare_image.py \
        backend/app/api/session.py \
        backend/tests/state/test_writers_per_node_only.py
git commit -m "refactor(state): drop legacy singleton writes — per-node is SSoT"
```

---

### Task 3: Persistence excludes per-node bytes + prepare_result

Today `_EXCLUDE_FROM_PERSIST` only excludes the singletons. Multi-image sessions write `image_bytes_by_node` (multi-MB per entry) into `document.v1.json` on every checkpoint. `prepare_result_by_node` carries a dataclass with numpy arrays — it would either explode the JSON or silently lose precision. Both must be excluded; `image_context_by_node` stays included (small, expensive to regenerate).

**Files:**
- Modify: `backend/app/session/persistence.py:36-39`
- Test: `backend/tests/session/test_persistence_per_node.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/session/test_persistence_per_node.py`:

```python
"""Persistence-layer per-node coverage.

The persisted document.v1.json MUST NOT carry per-node image bytes or
prepare_result (huge / regenerable). It MUST carry per-node image_context
(small, expensive to regenerate)."""

import json

from app.schemas.image_context import ImageContext
from app.services import disk_session_io
from app.session import persistence
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["mid"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_dumped_document_excludes_per_node_image_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes("in-1", b"AAAAAA", mime_type="image/jpeg")
    doc.set_image_bytes("in-2", b"BBBBBB", mime_type="image/jpeg")
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "image_bytes_by_node" not in payload


def test_dumped_document_excludes_per_node_prepare_result(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_prepare_result("in-1", object())
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "prepare_result_by_node" not in payload


def test_dumped_document_includes_per_node_image_context(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    doc = SessionDocument(session_id="s1")
    doc.set_image_context("in-1", _ctx())
    persistence.dump_document(doc, "s1")
    payload = json.loads((tmp_path / "s1" / "document.v1.json").read_text())
    assert "image_context_by_node" in payload
    assert payload["image_context_by_node"]["in-1"]["mood"] == "calm"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/session/test_persistence_per_node.py -v`
Expected: `test_dumped_document_excludes_per_node_image_bytes` and `test_dumped_document_excludes_per_node_prepare_result` FAIL; the third PASSES (it's already included by default).

- [ ] **Step 3: Edit `backend/app/session/persistence.py`** — extend `_EXCLUDE_FROM_PERSIST`:

```python
# Fields the persisted JSON intentionally omits. Order matches SessionDocument.
# Per-image-node doctrine: image_bytes are on disk under
# .sessions/<sid>/<image_node_id>.<ext>; prepare_result is a numpy-laden
# dataclass regenerated on demand by PrepareImageTool. image_context_by_node
# IS persisted (small + costly to regenerate). See _promote_singletons_to_per_node
# in app/state/document.py for the migration doctrine.
_EXCLUDE_FROM_PERSIST: set[str] = {
    "image_bytes",            # legacy singleton; multi-MB; image.<ext> already on disk
    "prepare_result",         # legacy singleton; regenerable by prepare_image tool
    "image_bytes_by_node",    # multi-MB per entry; restored on revive from disk
    "mime_type_by_node",      # restored on revive alongside the bytes
    "prepare_result_by_node", # numpy-laden dataclass; regenerable by prepare_image tool
}
```

Note: `mime_type_by_node` is excluded too because it travels with the bytes (revive will rebuild both from the per-node image files on disk via Task 5's helper).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/session/test_persistence_per_node.py -v`
Expected: 3 passed.

- [ ] **Step 5: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/session/persistence.py backend/tests/session/test_persistence_per_node.py
git commit -m "fix(persistence): exclude per-node image_bytes + prepare_result from checkpoint"
```

---

### Task 4: `disk_session_io.read_per_node_images()`

Revive needs to rebuild `image_bytes_by_node` + `mime_type_by_node` from the per-node image files on disk (written by `disk_session_io.write_image`). The current `load_session` only knows about the primary `image.<ext>`.

**Files:**
- Modify: `backend/app/services/disk_session_io.py`
- Test: `backend/tests/services/test_read_per_node_images.py` (create folder if needed)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/__init__.py` (empty file) if it doesn't exist, then `backend/tests/services/test_read_per_node_images.py`:

```python
"""disk_session_io.read_per_node_images — scan a session dir for any
per-image-node image files (`<image_node_id>.<ext>`, NOT the primary
`image.<ext>`) and return them as a mapping. Used by revive to restore
SessionDocument.image_bytes_by_node + mime_type_by_node."""

from app.services import disk_session_io


def test_returns_empty_for_no_session_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    assert disk_session_io.read_per_node_images("ghost") == {}


def test_skips_primary_image_file(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    assert disk_session_io.read_per_node_images("s1") == {}


def test_returns_per_node_images(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    disk_session_io.write_image("s1", "in-1", b"AAAA", "image/png")
    disk_session_io.write_image("s1", "in-2", b"BBBB", "image/webp")
    result = disk_session_io.read_per_node_images("s1")
    assert result == {
        "in-1": (b"AAAA", "image/png"),
        "in-2": (b"BBBB", "image/webp"),
    }


def test_ignores_unknown_extensions(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"primary", "image/jpeg", created_at=0.0)
    (tmp_path / "s1" / "notes.txt").write_text("hi")
    (tmp_path / "s1" / "meta.json").write_text("{}")  # already there
    assert disk_session_io.read_per_node_images("s1") == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/services/test_read_per_node_images.py -v`
Expected: FAIL with `AttributeError: module 'app.services.disk_session_io' has no attribute 'read_per_node_images'`.

- [ ] **Step 3: Implement in `backend/app/services/disk_session_io.py`**

Append (after `write_image`):

```python
# Inverse of _EXT_FOR_MIME — used by read_per_node_images to recover the
# MIME from a file extension on disk. Tracks _EXT_FOR_MIME exactly; if a
# new MIME is added there, mirror it here.
_MIME_FOR_EXT = {ext: mime for mime, ext in _EXT_FOR_MIME.items()}


def read_per_node_images(sid: str) -> dict[str, tuple[bytes, str]]:
    """Scan a session directory for per-image-node image files written by
    `write_image()`. Returns `{image_node_id: (bytes, mime_type)}`.

    Skips the primary `image.<ext>` (it lives in DiskRecord). Skips any
    file whose extension isn't a known image type — defends against
    incidental `.json` / `.txt` / dotfiles in the session dir.

    Used by revive to restore SessionDocument.image_bytes_by_node +
    mime_type_by_node. Returns `{}` when the session dir doesn't exist.
    """
    d = _session_dir(sid)
    if not d.exists():
        return {}
    out: dict[str, tuple[bytes, str]] = {}
    for path in d.iterdir():
        if not path.is_file():
            continue
        stem = path.stem
        if stem == "image":
            continue  # primary, owned by save_session/load_session
        ext = path.suffix.lstrip(".")
        mime = _MIME_FOR_EXT.get(ext)
        if mime is None:
            continue
        out[stem] = (path.read_bytes(), mime)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/services/test_read_per_node_images.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/disk_session_io.py \
        backend/tests/services/__init__.py \
        backend/tests/services/test_read_per_node_images.py
git commit -m "feat(disk-io): add read_per_node_images for revive"
```

---

### Task 5: Revive promotes singletons + rebuilds per-node bytes from disk

`_hydrate_into_store` in `revive.py` currently does `model_validate` and attaches the singleton `image_bytes` from disk — that's pre-per-node behaviour. Make it run `_promote_singletons_to_per_node()` immediately after validate, then re-attach BOTH the primary image (as `image_bytes_by_node["in-default"]`) and any per-node images from disk.

**Files:**
- Modify: `backend/app/session/revive.py`
- Test: `backend/tests/session/test_revive_per_node.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/session/test_revive_per_node.py`:

```python
"""End-to-end revive: persisted v1 document + per-node disk images →
rehydrated SessionDocument with the per-node-only doctrine applied."""

import time

from app.services import disk_session_io
from app.services.session_store import SessionStore
from app.session import persistence, revive
from app.state.document import DEFAULT_IMAGE_NODE_ID


def test_revive_rebuilds_image_bytes_by_node_from_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    # Stage a session with one primary + two per-node images on disk.
    disk_session_io.save_session("s1", b"PRIMARY", "image/jpeg", created_at=time.time())
    disk_session_io.write_image("s1", "in-1", b"AAAA", "image/png")
    disk_session_io.write_image("s1", "in-2", b"BBBB", "image/webp")
    # Persist a minimal document — no image_bytes (will be added by revive).
    from app.state.document import SessionDocument
    doc = SessionDocument(session_id="s1")
    persistence.dump_document(doc, "s1")

    store = SessionStore(ttl_seconds=60)
    n = revive.revive_all(store)
    assert n == 1
    revived = store.get_document("s1")
    # Primary image lives at in-default in the per-node dict.
    assert revived.get_image_bytes(DEFAULT_IMAGE_NODE_ID) == b"PRIMARY"
    assert revived.image_bytes == b""  # legacy singleton has been cleared
    assert revived.get_image_bytes("in-1") == b"AAAA"
    assert revived.get_image_bytes("in-2") == b"BBBB"
    assert revived.get_mime_type("in-1") == "image/png"


def test_revive_promotes_legacy_singletons_from_persisted_payload(tmp_path, monkeypatch):
    """A document persisted BEFORE the migration carries data in the legacy
    `image_context` singleton. Revive must promote it into the per-node dict."""
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    disk_session_io.save_session("s1", b"PRIMARY", "image/jpeg", created_at=time.time())
    # Build a v1 doc the old way (singleton image_context).
    from app.schemas.image_context import ImageContext
    from app.state.document import SessionDocument
    ctx = ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["mid"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )
    doc = SessionDocument(session_id="s1", image_context=ctx)
    persistence.dump_document(doc, "s1")

    store = SessionStore(ttl_seconds=60)
    revive.revive_all(store)
    revived = store.get_document("s1")
    assert revived.image_context is None
    assert revived.get_image_context(DEFAULT_IMAGE_NODE_ID) is not None
    assert revived.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "calm"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/session/test_revive_per_node.py -v`
Expected: both FAIL — revive currently attaches `image_bytes` to the singleton (not promoted) and doesn't read per-node images.

- [ ] **Step 3: Edit `backend/app/session/revive.py:_hydrate_into_store`**

Replace the whole function body:

```python
def _hydrate_into_store(
    store: "SessionStore",
    sid: str,
    disk: disk_session_io.DiskRecord,
    payload: dict,
) -> None:
    """Build a SessionDocument from `payload` (already-validated dict) and a
    SessionRecord around it, register it with the store.

    The on-disk document never carries image_bytes / mime / per-node image
    bytes — those are reattached here from disk_session_io. After
    model_validate we run `_promote_singletons_to_per_node()` so any
    pre-migration payload (singleton image_context / prepare_result) converges
    to the per-node-only doctrine before any tool touches it.
    """
    import time

    from app.services.session_store import SessionRecord
    from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument

    # Drop the version marker so model_validate doesn't trip on `extra="forbid"`.
    doc_dict = {k: v for k, v in payload.items() if k != "_schema_version"}
    # Legacy singletons may carry stale (or absent) data; we'll empty them
    # in the promotion step below. Re-attach the primary image just so
    # _promote_singletons_to_per_node can move it into in-default.
    doc_dict["image_bytes"] = disk.image_bytes
    doc_dict["mime_type"] = disk.mime_type

    doc = SessionDocument.model_validate(doc_dict)
    # Step 1: promote any legacy singleton state into the per-node dicts.
    # After this, doc.image_bytes / doc.image_context / doc.prepare_result
    # are empty; everything lives under image_*_by_node.
    doc._promote_singletons_to_per_node()
    # Step 2: rehydrate any additional per-node images written via
    # api/session.py:add_image_to_session. read_per_node_images returns
    # {image_node_id: (bytes, mime)} for every file other than the primary.
    for image_node_id, (data, mime) in disk_session_io.read_per_node_images(sid).items():
        # Don't overwrite — promotion above already put the primary at in-default.
        if image_node_id in doc.image_bytes_by_node:
            continue
        doc.set_image_bytes(image_node_id, data, mime_type=mime)

    now = time.monotonic()
    record = SessionRecord(
        image_bytes=disk.image_bytes,
        mime_type=disk.mime_type,
        created_at=now,
        last_seen=now,
        context=disk.context_json,
        document=doc,
    )
    # Direct insertion — we want to skip the on-demand lazy hydration since
    # we just did it ourselves. SessionStore exposes _records as a plain dict
    # and locks via _lock.
    with store._lock:
        store._records[sid] = record
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/session/test_revive_per_node.py -v`
Expected: 2 passed.

- [ ] **Step 5: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/session/revive.py backend/tests/session/test_revive_per_node.py
git commit -m "feat(revive): promote legacy singletons + rebuild per-node images from disk"
```

---

### Task 6: `Snapshot.capture` includes `image_context_by_node`; `apply_snapshot` restores it

Today `Snapshot` captures `canonical` / `widgets` / `masks` / `image_node_transforms` / `dismissals`. After analyze runs and a per-node `image_context` is populated, an undo currently leaves it stale (or worse: the same value as before the analyze, so the user undoes "into" a state that lacks regions). Add `image_context_by_node` to the snapshot and restore it. `prepare_result_by_node` stays out — regenerable.

**Files:**
- Modify: `backend/app/session/history.py:Snapshot`
- Modify: `backend/app/state/document.py:apply_snapshot`
- Test: `backend/tests/session/test_history_per_node.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/session/test_history_per_node.py`:

```python
"""Per-image-node image_context must survive undo/redo/revert."""

from app.schemas.image_context import ImageContext
from app.session.history import Snapshot
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx(mood: str) -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["mid"], mood=mood,
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


def test_snapshot_capture_includes_image_context_by_node():
    doc = SessionDocument(session_id="s1")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("calm"))
    doc.set_image_context("in-2", _ctx("bright"))
    snap = Snapshot.capture(doc)
    assert snap.image_context_by_node[DEFAULT_IMAGE_NODE_ID]["mood"] == "calm"
    assert snap.image_context_by_node["in-2"]["mood"] == "bright"


def test_apply_snapshot_restores_image_context_by_node():
    doc = SessionDocument(session_id="s1")
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("calm"))
    snap = Snapshot.capture(doc)
    # Now mutate the doc as if a tool ran.
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("excited"))
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "excited"
    # Apply the older snapshot — should roll back to "calm".
    doc.apply_snapshot(snap)
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "calm"


def test_apply_snapshot_clears_legacy_singleton_image_context():
    """Whatever apply_snapshot writes must leave the legacy singleton empty —
    the per-node dict is the only canonical storage."""
    doc = SessionDocument(session_id="s1")
    doc.image_context = _ctx("legacy")  # pretend a pre-migration writer set this
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, _ctx("per-node"))
    snap = Snapshot.capture(doc)
    doc.apply_snapshot(snap)
    assert doc.image_context is None
    assert doc.get_image_context(DEFAULT_IMAGE_NODE_ID).mood == "per-node"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/session/test_history_per_node.py -v`
Expected: `test_snapshot_capture_includes_image_context_by_node` FAIL — Snapshot has no such field.

- [ ] **Step 3: Edit `backend/app/session/history.py:Snapshot`**

Update the class:

```python
class Snapshot(BaseModel):
    """Subset of SessionDocument captured at a user-action boundary.

    Intentionally INCLUDED:
      - canonical, widgets, masks, image_node_transforms, dismissals
        (user-action-mutable; per the operations layer)
      - image_context_by_node (per-image-node analysis result; mutated by
        analyze_context / precompute_regions, which ARE user actions)

    Intentionally EXCLUDED:
      - image_bytes / image_bytes_by_node (multi-MB; identical across snapshots)
      - prepare_result / prepare_result_by_node (regenerable by prepare_image)
      - history (event log; its own ledger, would compound quickly)
      - image_context (legacy singleton; the per-node dict is the SSoT)
      - revision / updated_at (rebuilt on apply)
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    canonical: dict[str, Any] = Field(default_factory=dict)
    widgets: dict[str, Any] = Field(default_factory=dict)
    widget_order: list[str] = Field(default_factory=list)
    masks: dict[str, Any] = Field(default_factory=dict)
    image_node_transforms: dict[str, Any] = Field(default_factory=dict)
    dismissals: list[Any] = Field(default_factory=list)
    image_context_by_node: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def capture(cls, doc: "SessionDocument") -> "Snapshot":
        """Deep-copy the doc's mutable state into a Snapshot. Use `mode='python'`
        on widgets/masks/dismissals/image_context so apply_snapshot can
        model_validate them back to their typed shapes without round-tripping
        through JSON."""
        return cls(
            canonical=_deep_copy_jsonable(doc.canonical),
            widgets={k: w.model_dump(mode="python") for k, w in doc.widgets.items()},
            widget_order=list(doc.widget_order),
            masks={k: m.model_dump(mode="python") for k, m in doc.masks.items()},
            image_node_transforms=_deep_copy_jsonable(doc.image_node_transforms),
            dismissals=[r.model_dump(mode="python") for r in doc.dismissals],
            image_context_by_node={
                k: v.model_dump(mode="python")
                for k, v in doc.image_context_by_node.items()
            },
        )
```

- [ ] **Step 4: Edit `backend/app/state/document.py:apply_snapshot`**

Update to restore image_context_by_node AND clear the legacy singleton:

```python
    def apply_snapshot(self, snap: "Any") -> StateEvent:
        """Restore the doc's mutable state from a Snapshot in-place. Bumps
        revision and emits one `history.applied` event carrying the new
        operation_graph and snapshot summary.

        Used by the undo/redo/revert endpoints. The snapshot is constructed
        in app/session/history.py — typed as Any here to avoid a cycle
        (history.py imports SessionDocument for type hints).
        """
        from app.schemas.image_context import ImageContext
        from app.schemas.widget import DismissalRule, MaskRecord, Widget

        self.canonical = _deep_copy(snap.canonical)
        self.widgets = {wid: Widget.model_validate(w) for wid, w in snap.widgets.items()}
        self.widget_order = list(snap.widget_order)
        self.masks = {mid: MaskRecord.model_validate(m) for mid, m in snap.masks.items()}
        self.image_node_transforms = _deep_copy(snap.image_node_transforms)
        self.dismissals = [DismissalRule.model_validate(d) for d in snap.dismissals]
        # Per-image-node image_context: restore exactly what was captured.
        # The legacy singleton is cleared so apply_snapshot leaves a doc
        # that satisfies the per-node-only doctrine.
        self.image_context_by_node = {
            k: ImageContext.model_validate(v)
            for k, v in snap.image_context_by_node.items()
        }
        self.image_context = None
        return self._emit("history.applied", {
            "operationGraph": self._op_graph_payload(),
            "widgets": [self.widgets[wid].model_dump(mode="json", by_alias=True)
                        for wid in self.widget_order if wid in self.widgets],
            "widgetIds": list(self.widget_order),
            "masksIndex": [
                {"id": m.id, "width": m.width, "height": m.height,
                 "source": m.source, "label": m.label,
                 "imageNodeId": m.image_node_id}
                for m in self.masks.values()
            ],
        })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/session/test_history_per_node.py -v`
Expected: 3 passed.

- [ ] **Step 6: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green. The existing `test_snapshot.py` / `test_document.py` continue passing because the new field defaults to `{}` and apply_snapshot's new branch is a no-op when the snapshot has no per-node context.

- [ ] **Step 7: Commit**

```bash
git add backend/app/session/history.py \
        backend/app/state/document.py \
        backend/tests/session/test_history_per_node.py
git commit -m "feat(history): capture + restore image_context_by_node in undo snapshots"
```

---

### Task 7: Document the doctrine in the four touched files

Add a paragraph at the top of each module that anchors the per-node-only rule so future readers don't accidentally reintroduce a singleton write.

**Files:**
- Modify: `backend/app/state/document.py` — append to the section comment above the per-image-node accessors.
- Modify: `backend/app/session/persistence.py` — extend the module docstring.
- Modify: `backend/app/session/history.py` — extend the module docstring.
- Modify: `backend/app/session/revive.py` — extend the module docstring.

- [ ] **Step 1: Edit `backend/app/state/document.py`** — replace the line above `set_image_bytes` (currently `# ---------------- per-image-node accessors ----------------`) with:

```python
    # ---------------- per-image-node accessors ----------------
    #
    # DOCTRINE — per-image-node addressing is the canonical storage. The
    # legacy `image_bytes` / `mime_type` / `image_context` / `prepare_result`
    # singleton fields exist solely to load older persisted documents and are
    # emptied on revive by `_promote_singletons_to_per_node()`. New code MUST
    # write through these `set_*(image_node_id, …)` accessors and read through
    # `get_*(image_node_id)`. `prepare_result_by_node` is regenerable from
    # `image_bytes_by_node` via PrepareImageTool — it is intentionally not
    # persisted and not snapshotted.
```

- [ ] **Step 2: Edit `backend/app/session/persistence.py`** — replace the module docstring header (the first triple-quote block, currently ending "...the SessionStore, the engine, the event bus."):

```python
"""Pure disk I/O for the persisted SessionDocument artifact.

Storage layout under `backend/.sessions/<sid>/`:

    image.<ext>             — raw uploaded bytes (owned by disk_session_io)
    <image_node_id>.<ext>   — additional per-image-node bytes (owned by disk_session_io)
    meta.json               — mime_type + created_at (owned by disk_session_io)
    context.json            — legacy ImageContext cache (owned by disk_session_io)
    document.v1.json        — full SessionDocument snapshot — owned by us
    document.v1.bak.json    — rotated previous version (crash recovery)

`document.v1.json` excludes fields that are either huge (image_bytes,
image_bytes_by_node — already on disk), regenerable (prepare_result,
prepare_result_by_node — produced by prepare_image), or runtime-only
(private event-sink attrs). It DOES include image_context_by_node (small,
expensive to regenerate). See `_promote_singletons_to_per_node` in
app/state/document.py for the per-image-node doctrine.

This module is intentionally pure. Caller hands us a SessionDocument and a
session id; we serialise, write atomically, rotate. No knowledge of the
SessionStore, the engine, the event bus.
"""
```

- [ ] **Step 3: Edit `backend/app/session/history.py`** — append a paragraph to the module docstring (after "...endpoints share one rehydration path."):

```python
"""HistoryEngine — snapshot-based, backend-owned undo/redo.

Phase 3 of the SSOT refactor. Replaces the frontend's 20-deep
client-only history stack with a per-session engine that captures
SessionDocument snapshots at every user-action boundary.

Why snapshots, not event-sourced inverses:
  Reversibility becomes a property of the engine, not of each op. When
  a new tool ships, undo works the moment it's registered — there's no
  "remember to define the inverse" foot-gun.

  Snapshot size is small (KBs, not MBs): we capture only the canonical
  state + the widgets/masks/transforms metadata + per-image-node
  image_context. Pixel data, image bytes, prepare_result (regenerable),
  and the event log itself are excluded.

What lives where:
  - One HistoryEngine per SessionRecord (in-memory; not persisted today).
  - Snapshots captured by the tool registry BEFORE/AFTER any tool whose
    `is_user_action` is True.
  - apply_snapshot() lives on SessionDocument so the undo/redo/revert
    endpoints share one rehydration path.

Per-image-node doctrine (see app/state/document.py):
  - image_context_by_node IS captured and restored.
  - image_bytes_by_node and prepare_result_by_node are NOT captured —
    bytes are huge and identical across snapshots; prepare_result is
    regenerable on demand via PrepareImageTool.
  - apply_snapshot clears the legacy singleton image_context so a
    post-undo document satisfies the per-node-only doctrine.
"""
```

- [ ] **Step 4: Edit `backend/app/session/revive.py`** — append a paragraph to the module docstring (after "...they'll be cleaned up by prune_disk."):

```python
"""Revive — rehydrate persisted SessionDocuments on backend startup.

Runs once at FastAPI startup (via the lifespan hook in main.py). Scans
SESSIONS_DIR for session directories containing a document.v1.json and
restores each into the SessionStore so the next API request finds an
already-hydrated record.

Errors per session are logged and skipped — one bad session doesn't
prevent the rest from coming back. The disk_session_io image file is
required (no document is useful without its source image); sessions
without one are left alone (they'll be cleaned up by prune_disk).

Per-image-node doctrine (see app/state/document.py):
  After model_validate, every revived document is passed through
  `_promote_singletons_to_per_node()` so legacy singleton state is
  promoted into the per-node dicts and the singletons are cleared.
  Then `disk_session_io.read_per_node_images()` rebuilds any
  additional per-node image bytes from disk (written by
  `api/session.py:add_image_to_session`). After revive, no document
  in the store has any data in the legacy singleton fields.
"""
```

- [ ] **Step 5: Run the full backend suite to confirm no regression**

Run: `cd backend && .venv/bin/pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/state/document.py \
        backend/app/session/persistence.py \
        backend/app/session/history.py \
        backend/app/session/revive.py
git commit -m "docs(state): record the per-image-node-only doctrine in all four touched modules"
```

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| C2 — persistence writes per-node image data | Task 3 (extends `_EXCLUDE_FROM_PERSIST`) |
| C3 — undo drops per-node image_context | Task 6 (Snapshot + apply_snapshot) |
| H8 — `prepare_result` excluded with no regen guarantee | Docs in Task 6 + Task 7 record the regen-on-demand contract; existing `analyze_context.py:62` lazy regen path is preserved (no code change needed there — confirmed during research) |
| H9 — singleton↔per-node migration incomplete, no sync rule | Tasks 1, 2, 5 (promote helper + writer cleanup + revive integration) |

All four audit findings have a task. The H8 case is satisfied by combining the persistence exclusion (Task 3) with the existing lazy-regen call site, made explicit via documentation (Task 7). No additional code is needed — the regeneration already happens; we just stop persisting the dataclass.

**Placeholder scan:** none. Every task has full code; tests are runnable as written.

**Type consistency:** `_promote_singletons_to_per_node` defined in Task 1 is referenced in Task 5 and Task 7. `disk_session_io.read_per_node_images` defined in Task 4 is referenced in Task 5. `Snapshot.image_context_by_node` defined in Task 6 — apply_snapshot in the same task reads from `snap.image_context_by_node`. `DEFAULT_IMAGE_NODE_ID` (already exists at document.py:22) is referenced throughout — no rename. All identifiers consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-per-node-migration-coherence.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
