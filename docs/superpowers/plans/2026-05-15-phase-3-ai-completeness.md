# Phase 3 — AI Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the thesis's T2/T3 AI commitments end-to-end: real `/api/refine`, AI adjustment provenance round-tripped through history + persistence, multi-panel coexistence with refine + reset affordances, reasoning-badge model identity, and verified prompt-cache reuse.

**Architecture:** Phase 1 already produced `OperationGraph` plumbing, `ai-panel` layer materialisation (with `aiSource` synthesis), the `ReasoningBadge` primitive, and cache-controlled prompts. Phase 3 fills the remaining gaps: backend gains `generate_refined_panel` + session-scoped graph cache + cache-token logging; frontend gains `refinePanel` client, `AiPanelHeader` with refine/reset buttons, a missing-by-omission `Toast` primitive, and a serializer/session-storage pass to round-trip `aiSource` (currently dropped).

**Tech Stack:** Backend — Python 3.11+, FastAPI, Anthropic SDK, Pydantic v2, pytest (existing). Frontend — React 19, TypeScript strict, Zustand, Radix UI (Tooltip already in use), Framer Motion (Toast), vitest (added in Phase 2).

**Spec reference:** [`docs/superpowers/specs/2026-05-15-phase-3-ai-completeness-design.md`](../specs/2026-05-15-phase-3-ai-completeness-design.md).

---

## File Structure

### Created (backend)

| Path | Responsibility |
|---|---|
| `backend/tests/test_refine.py` | Endpoint tests for `/api/refine` (happy, 404, 400, 502, Pydantic-retry) |
| `backend/tests/test_cache_markers.py` | Structural assertions that `cache_control` is on system+image+context blocks for both panel and refine paths |
| `backend/tests/test_session_graphs.py` | `SessionStore.store_graph` / `get_graph` lifecycle |

### Modified (backend)

| Path | Change |
|---|---|
| `backend/app/services/session_store.py` | Add `graphs: dict[str, OperationGraph]` per record, `store_graph`/`get_graph` |
| `backend/app/services/anthropic_client.py` | Add `generate_refined_panel`; add `_log_cache_stats` helper; call from all three Claude paths |
| `backend/app/api/panel.py` | Store returned graph in session before returning |
| `backend/app/api/refine.py` | Replace 501 stub with real implementation |

### Created (frontend)

| Path | Responsibility |
|---|---|
| `src/components/inspector/AiPanelHeader.tsx` | Level-2: refine input + reset button bar |
| `src/components/ui/Toast.tsx` | Tiny primitive for non-blocking error surfaces |
| `src/store/ai-panel-actions.test.ts` | Vitest unit tests on materialise + refined materialise + reset |

### Modified (frontend)

| Path | Change |
|---|---|
| `src/store/ai-panel-actions.ts` | Fix `aiSource` source-of-truth (per-binding reasoning + metadata.generated_at); add `addRefinedAiPanelLayer`; add `resetPanelToSuggestion` |
| `src/store/layer-slice.ts` | Add `updateAdjustmentParams(layerId, adjustmentId, params)` (no equivalent in Phase 1) |
| `src/lib/ai-client.ts` | Add `refinePanel(sessionId, priorGraphId, instruction)` |
| `src/components/inspector/AiPanelSection.tsx` | Render `AiPanelHeader`; thread per-binding `aiSource` data into `ReasoningBadge` |
| `src/components/ui/ReasoningBadge.tsx` | Add `modelVersion?: string` prop; render alongside modelName in tooltip |
| `src/core/serializer.ts` | Round-trip `aiSource` on adjustments (currently dropped) |
| `src/core/session-storage.ts` | Same — `aiSource` survives session reload |

---

## Pre-flight

These prerequisites must be true before starting any task. **Do not skip these checks.**

- [ ] **P0a:** On `dev` branch, clean tree:
  ```bash
  git branch --show-current && git status --porcelain
  ```
  Expected: `dev` and empty.

- [ ] **P0b:** Phase 2 baseline green:
  ```bash
  npm run check
  ```
  Expected: exit 0. 17 vitest tests pass. 40 pre-existing lint warnings are acceptable.

- [ ] **P0c:** Backend Python env present:
  ```bash
  ls backend/.venv/bin/python 2>&1
  ```
  If missing: `cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt`.

- [ ] **P0d:** Backend tests baseline green:
  ```bash
  cd backend && .venv/bin/pytest -q
  ```
  Expected: existing tests pass. Record the count.

- [ ] **P0e:** Confirm starting facts from Phase 1 (verifies the plan's premise; only the diffs matter):
  ```bash
  grep -n "aiSource" src/store/ai-panel-actions.ts | head -3
  grep -n "aiSource" src/store/layer-slice.ts | head -3
  cat backend/app/api/refine.py
  ```
  Expected: `aiSource` is set in `ai-panel-actions.ts` (Phase 1 already does this); `Adjustment.aiSource` is on the layer type; `refine.py` is a 501 stub.

---

## Task 1: Backend — SessionStore gains a graph cache

The refine endpoint needs to recall the prior `OperationGraph` by ID. Extend `SessionRecord` with a per-session graph dict.

**Files:**
- Modify: `backend/app/services/session_store.py`
- Create: `backend/tests/test_session_graphs.py`

- [ ] **Step 1: Write the failing test**

Write `backend/tests/test_session_graphs.py`:

```python
import pytest
from app.services.session_store import SessionStore, SessionNotFound


def test_store_and_get_graph_round_trip():
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    graph = {"id": "g1", "user_goal": "warmer"}
    store.store_graph(sid, "g1", graph)
    assert store.get_graph(sid, "g1") == graph


def test_get_graph_returns_none_for_unknown_id():
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    assert store.get_graph(sid, "missing") is None


def test_store_graph_raises_for_unknown_session():
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.store_graph("nope", "g1", {"id": "g1"})


def test_get_graph_raises_for_unknown_session():
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.get_graph("nope", "g1")
```

- [ ] **Step 2: Run — expect failures**

```bash
cd backend && .venv/bin/pytest tests/test_session_graphs.py -v
```
Expected: 4 failures (`AttributeError: 'SessionStore' object has no attribute 'store_graph'`).

- [ ] **Step 3: Extend `SessionRecord` + `SessionStore`**

In `backend/app/services/session_store.py`, modify the `SessionRecord` dataclass to add a `graphs` field, and add `store_graph` / `get_graph` methods on `SessionStore`. The full updated file:

```python
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


class SessionNotFound(KeyError):
    pass


@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None
    graphs: dict[str, dict[str, Any]] = field(default_factory=dict)


class SessionStore:
    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._records: dict[str, SessionRecord] = {}
        self._lock = Lock()

    def _is_expired(self, record: SessionRecord) -> bool:
        return (time.monotonic() - record.last_seen) > self._ttl

    def create(self, image_bytes: bytes, mime_type: str) -> str:
        sid = uuid.uuid4().hex
        now = time.monotonic()
        with self._lock:
            self._records[sid] = SessionRecord(
                image_bytes=image_bytes,
                mime_type=mime_type,
                created_at=now,
                last_seen=now,
            )
        return sid

    def get(self, sid: str) -> SessionRecord:
        with self._lock:
            record = self._records.get(sid)
            if record is None:
                raise SessionNotFound(sid)
            if self._is_expired(record):
                self._records.pop(sid, None)
                raise SessionNotFound(sid)
            record.last_seen = time.monotonic()
            return record

    def touch(self, sid: str) -> None:
        self.get(sid)

    def set_context(self, sid: str, context: dict[str, Any]) -> None:
        record = self.get(sid)
        record.context = context

    def store_graph(self, sid: str, graph_id: str, graph: dict[str, Any]) -> None:
        record = self.get(sid)
        record.graphs[graph_id] = graph

    def get_graph(self, sid: str, graph_id: str) -> dict[str, Any] | None:
        record = self.get(sid)
        return record.graphs.get(graph_id)
```

- [ ] **Step 4: Run — tests pass**

```bash
cd backend && .venv/bin/pytest tests/test_session_graphs.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Run full backend suite — confirm no regressions**

```bash
cd backend && .venv/bin/pytest -q
```
Expected: previous baseline + 4 new tests, all green.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/session_store.py backend/tests/test_session_graphs.py
git commit -m "feat(backend): SessionStore caches OperationGraphs per session"
```

---

## Task 2: Backend — AnthropicClient gains `generate_refined_panel`

Refine has the same Claude+Pydantic+cache-control shape as panel but adds a prior-graph JSON block and a refinement instruction. The first three blocks (system, image, context) carry `cache_control`; the prior-graph and instruction blocks do NOT (they vary per call and shouldn't fragment the prefix).

**Files:**
- Modify: `backend/app/services/anthropic_client.py`

- [ ] **Step 1: Read the existing client** to understand the panel pattern. Reference: `backend/app/services/anthropic_client.py` lines 77–116 (`generate_panel`).

- [ ] **Step 2: Add the refine system prompt + tool block** at the top of the file, after `PANEL_SYSTEM_PROMPT`:

```python
REFINE_SYSTEM_PROMPT = """You are a photo-editing assistant refining a prior \
suggestion. Given an image, its context, your prior OperationGraph, and a \
refinement instruction from the user (e.g. "more subtle", "only the sky"), \
produce a NEW OperationGraph that adjusts the suggestion accordingly. Keep \
labels goal-relevant. Mint a fresh graph `id`. Call the \
`emit_operation_graph` tool exactly once. Do not return prose."""
```

- [ ] **Step 3: Add the `generate_refined_panel` method** below `generate_panel`:

```python
    def generate_refined_panel(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: ImageContext,
        prior_graph: dict[str, Any],
        instruction: str,
    ) -> OperationGraph:
        last_error: ValidationError | None = None
        for _ in range(3):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=2048,
                system=[{"type": "text", "text": REFINE_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[OPERATION_GRAPH_TOOL],
                tool_choice={"type": "tool", "name": "emit_operation_graph"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {
                                "type": "text",
                                "text": f"Image context: {context.model_dump_json()}",
                                "cache_control": {"type": "ephemeral"},
                            },
                            {
                                "type": "text",
                                "text": f"Prior graph: {json.dumps(prior_graph)}",
                            },
                            {"type": "text", "text": f"Refinement instruction: {instruction}"},
                        ],
                    }
                ],
            )
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_operation_graph":
                    try:
                        return OperationGraph.model_validate(block.input)
                    except ValidationError as e:
                        last_error = e
                        break
            else:
                raise RuntimeError("Anthropic did not emit emit_operation_graph tool call")
        raise RuntimeError(f"Refine generation failed validation after retries: {last_error}")
```

- [ ] **Step 4: Add the `json` import** at the top of `anthropic_client.py` if not present:

```python
import json
```

- [ ] **Step 5: Confirm it compiles**

```bash
cd backend && .venv/bin/python -c "from app.services.anthropic_client import AnthropicClient; print(AnthropicClient.generate_refined_panel.__name__)"
```
Expected: `generate_refined_panel`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/anthropic_client.py
git commit -m "feat(backend): AnthropicClient.generate_refined_panel with cached prefix"
```

---

## Task 3: Backend — cache-control structural test

Pin the invariant that the prefix (system + image + context) is marked cacheable for all three paths, and that the tail (goal / prior-graph / instruction) is not. This is the spec's cache-hit verification's structural half.

**Files:**
- Create: `backend/tests/test_cache_markers.py`

- [ ] **Step 1: Write the test**

Write `backend/tests/test_cache_markers.py`:

```python
"""
Structural assertions that the cache_control: ephemeral marker is on the
prompt-prefix blocks (system, image, context) for both panel and refine paths,
and NOT on the per-call tail blocks (goal / prior-graph / instruction).
"""
from __future__ import annotations

from unittest.mock import MagicMock

from app.schemas.image_context import ImageContext
from app.services.anthropic_client import AnthropicClient


class _StubBlock:
    def __init__(self, name: str, value: dict) -> None:
        self.type = "tool_use"
        self.name = name
        self.input = value


def _make_client(monkeypatch, captured: list[dict]) -> AnthropicClient:
    client = AnthropicClient.__new__(AnthropicClient)
    client._client = MagicMock()  # type: ignore[attr-defined]
    client._model = "claude-opus-4-7"  # type: ignore[attr-defined]

    def fake_create(**kwargs):
        captured.append(kwargs)
        resp = MagicMock()
        resp.content = [
            _StubBlock(
                "emit_operation_graph",
                {
                    "id": "g1",
                    "user_goal": "warmer",
                    "nodes": [],
                    "panel_bindings": [],
                    "metadata": {},
                },
            )
        ]
        return resp

    client._client.messages.create = fake_create  # type: ignore[attr-defined]
    return client


def _context() -> ImageContext:
    return ImageContext.model_validate(
        {
            "subjects": ["sky"],
            "lighting": "flat",
            "dominant_tones": ["midtones"],
            "mood": "calm",
            "candidate_regions": [],
            "model_name": "claude-opus-4-7",
            "model_version": "2026-01",
            "generated_at": "2026-05-15T00:00:00Z",
        }
    )


def test_generate_panel_marks_system_image_context_cacheable(monkeypatch):
    captured: list[dict] = []
    client = _make_client(monkeypatch, captured)
    client.generate_panel(b"img", "image/jpeg", _context(), "warmer")
    assert len(captured) == 1
    kwargs = captured[0]

    # system carries cache_control
    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}

    # user content: image (idx 0) + context (idx 1) carry cache_control
    user_content = kwargs["messages"][0]["content"]
    assert user_content[0]["type"] == "image"
    assert user_content[0]["cache_control"] == {"type": "ephemeral"}
    assert user_content[1]["text"].startswith("Image context:")
    assert user_content[1]["cache_control"] == {"type": "ephemeral"}

    # tail (goal) must NOT carry cache_control
    assert user_content[2]["text"].startswith("User goal:")
    assert "cache_control" not in user_content[2]


def test_generate_refined_panel_marks_prefix_cacheable_only(monkeypatch):
    captured: list[dict] = []
    client = _make_client(monkeypatch, captured)
    client.generate_refined_panel(
        b"img", "image/jpeg", _context(), {"id": "prior", "user_goal": "warmer"}, "more subtle"
    )
    assert len(captured) == 1
    kwargs = captured[0]

    assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}

    user_content = kwargs["messages"][0]["content"]
    assert user_content[0]["cache_control"] == {"type": "ephemeral"}
    assert user_content[1]["text"].startswith("Image context:")
    assert user_content[1]["cache_control"] == {"type": "ephemeral"}

    # Prior graph + instruction must NOT carry cache_control
    assert user_content[2]["text"].startswith("Prior graph:")
    assert "cache_control" not in user_content[2]
    assert user_content[3]["text"].startswith("Refinement instruction:")
    assert "cache_control" not in user_content[3]
```

- [ ] **Step 2: Run — tests pass**

```bash
cd backend && .venv/bin/pytest tests/test_cache_markers.py -v
```
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_cache_markers.py
git commit -m "test(backend): structural assertions on cache_control prompt markers"
```

---

## Task 4: Backend — cache-token logging

Spec calls for stdout logs of `cache_creation_input_tokens` + `cache_read_input_tokens` per Claude call. Use Python `logging` (not `print`) so it's filterable; the existing app already configures basic logging on startup.

**Files:**
- Modify: `backend/app/services/anthropic_client.py`

- [ ] **Step 1: Add logger + helper**

Near the top of `backend/app/services/anthropic_client.py`, after the imports:

```python
import logging

logger = logging.getLogger(__name__)


def _log_cache_stats(call: str, session_id: str | None, response: Any) -> None:
    usage = getattr(response, "usage", None)
    if usage is None:
        logger.warning("call=%s session=%s usage missing on response", call, session_id)
        return
    create = getattr(usage, "cache_creation_input_tokens", 0) or 0
    read = getattr(usage, "cache_read_input_tokens", 0) or 0
    total_input = getattr(usage, "input_tokens", 0) or 0
    logger.info(
        "call=%s session=%s cache_create=%d cache_read=%d input_tokens=%d",
        call, session_id, create, read, total_input,
    )
```

- [ ] **Step 2: Update method signatures to accept `session_id`**

Change the three Claude-call methods to accept an optional `session_id: str | None = None` keyword (used only for logging). Update `analyze_image`, `generate_panel`, `generate_refined_panel`. After each `response = self._client.messages.create(...)` call, invoke:

```python
_log_cache_stats("analyze", session_id, response)   # in analyze_image
_log_cache_stats("panel", session_id, response)     # in generate_panel
_log_cache_stats("refine", session_id, response)    # in generate_refined_panel
```

(For `generate_panel`/`generate_refined_panel`, log inside the for-loop so retries are visible.)

- [ ] **Step 3: Update API callers to pass `session_id`**

In `backend/app/api/panel.py`, change the `client.generate_panel(...)` call to add `session_id=body.session_id`:

```python
return client.generate_panel(
    image_bytes=record.image_bytes,
    mime_type=record.mime_type,
    context=context,
    user_goal=body.user_goal,
    session_id=body.session_id,
)
```

Similar for `client.analyze_image(...)` inside `panel.py` (line ~38) — add `session_id=body.session_id`.

In `backend/app/api/analyze.py`, do the same — pass `session_id`. Read the file first to confirm the call shape.

- [ ] **Step 4: Run — backend tests still pass**

```bash
cd backend && .venv/bin/pytest -q
```
Expected: prior count + 2 (from Task 3) all pass; cache_marker tests still green (they don't pass `session_id` — verify the default `None` keeps them green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/app/api/panel.py backend/app/api/analyze.py
git commit -m "feat(backend): log cache_creation/cache_read token usage per Claude call"
```

---

## Task 5: Backend — `/api/refine` real implementation

**Files:**
- Modify: `backend/app/api/refine.py`
- Modify: `backend/app/api/panel.py` (store generated graph)
- Create: `backend/tests/test_refine.py`

- [ ] **Step 1: Write the failing tests**

Write `backend/tests/test_refine.py`:

```python
from __future__ import annotations

from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionStore


@pytest.fixture
def client_with_session(monkeypatch, sample_operation_graph, sample_image_context):
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    store.set_context(sid, sample_image_context)
    store.store_graph(sid, "graph_01", sample_operation_graph)

    monkeypatch.setattr(deps, "get_session_store", lambda: store)

    fake = MagicMock()
    fake.generate_refined_panel = MagicMock(
        return_value=OperationGraph.model_validate({**sample_operation_graph, "id": "graph_02"})
    )
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)

    return TestClient(app), sid, fake


def test_refine_happy_path(client_with_session):
    tc, sid, fake = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "graph_02"
    fake.generate_refined_panel.assert_called_once()


def test_refine_stores_new_graph_in_session(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 200
    # Subsequent refine using the new graph id should succeed (proves it was stored)
    r2 = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_02", "instruction": "even subtler"
    })
    assert r2.status_code == 200


def test_refine_404_on_missing_session(client_with_session):
    tc, _, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": "nope", "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 404
    assert "session" in r.json()["detail"]


def test_refine_404_on_missing_graph(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "missing", "instruction": "more subtle"
    })
    assert r.status_code == 404
    assert "graph" in r.json()["detail"]


def test_refine_400_on_empty_instruction(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": ""
    })
    assert r.status_code == 400


def test_refine_400_on_oversize_instruction(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "x" * 501
    })
    assert r.status_code == 400


def test_refine_502_on_anthropic_runtime_error(monkeypatch, sample_operation_graph, sample_image_context):
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    store.set_context(sid, sample_image_context)
    store.store_graph(sid, "graph_01", sample_operation_graph)
    monkeypatch.setattr(deps, "get_session_store", lambda: store)

    fake = MagicMock()
    fake.generate_refined_panel.side_effect = RuntimeError("anthropic down")
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)

    tc = TestClient(app)
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 502
```

- [ ] **Step 2: Run — tests fail**

```bash
cd backend && .venv/bin/pytest tests/test_refine.py -v
```
Expected: all 7 fail (501 stub returns from /api/refine).

- [ ] **Step 3: Replace the stub**

Replace the entire contents of `backend/app/api/refine.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph
from app.services.anthropic_client import AnthropicClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_client() -> AnthropicClient:
    return deps.get_anthropic_client()


class RefineRequest(BaseModel):
    session_id: str
    prior_graph_id: str
    instruction: str = Field(..., min_length=1, max_length=500)


@router.post("/refine", response_model=OperationGraph)
async def refine(
    body: RefineRequest,
    store: SessionStore = Depends(_get_store),
    client: AnthropicClient = Depends(_get_client),
) -> OperationGraph:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

    prior = store.get_graph(body.session_id, body.prior_graph_id)
    if prior is None:
        raise HTTPException(status_code=404, detail="prior graph not found")

    if record.context is None:
        raise HTTPException(status_code=400, detail="session has no image context")
    context = ImageContext.model_validate(record.context)

    try:
        graph = client.generate_refined_panel(
            image_bytes=record.image_bytes,
            mime_type=record.mime_type,
            context=context,
            prior_graph=prior,
            instruction=body.instruction,
            session_id=body.session_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"refine failed: {e}")

    store.store_graph(body.session_id, graph.id, graph.model_dump(mode="json"))
    return graph
```

- [ ] **Step 4: Make `panel.py` store the generated graph too**

In `backend/app/api/panel.py`, replace the return statement with:

```python
    graph = client.generate_panel(
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
        context=context,
        user_goal=body.user_goal,
        session_id=body.session_id,
    )
    store.store_graph(body.session_id, graph.id, graph.model_dump(mode="json"))
    return graph
```

- [ ] **Step 5: Update `generate_refined_panel` signature**

It needs to accept `session_id` kwarg added in Task 4. Verify by reading `backend/app/services/anthropic_client.py`. If the keyword wasn't added in Task 4 (it should have been), add it now:

```python
    def generate_refined_panel(
        self,
        image_bytes: bytes,
        mime_type: str,
        context: ImageContext,
        prior_graph: dict[str, Any],
        instruction: str,
        session_id: str | None = None,
    ) -> OperationGraph:
        ...
        _log_cache_stats("refine", session_id, response)  # inside the loop
```

- [ ] **Step 6: Run all tests**

```bash
cd backend && .venv/bin/pytest -q
```
Expected: all green, including the 7 new refine tests.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/refine.py backend/app/api/panel.py backend/app/services/anthropic_client.py backend/tests/test_refine.py
git commit -m "feat(backend): /api/refine real implementation with session graph cache"
```

---

## Task 6: Frontend — `ai-client.ts` gains `refinePanel`

**Files:**
- Modify: `src/lib/ai-client.ts`

- [ ] **Step 1: Add the method**

At the bottom of `src/lib/ai-client.ts`, append:

```ts
export async function refinePanel(
  sessionId: string,
  priorGraphId: string,
  instruction: string,
): Promise<OperationGraph> {
  const raw = await postJson<unknown>('/api/refine', {
    session_id: sessionId,
    prior_graph_id: priorGraphId,
    instruction,
  });
  return OperationGraphSchema.parse(raw);
}
```

- [ ] **Step 2: Verify**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai-client.ts
git commit -m "feat(ai): ai-client.refinePanel calls /api/refine"
```

---

## Task 7: Frontend — fix `addAiPanelLayer` provenance source-of-truth

The current Phase-1 implementation has two small divergences from the spec:

- `aiSource.reasoning` is set to `graph.reasoning` (graph-level) regardless of whether the binding has its own reasoning.
- `aiSource.generatedAt` uses `new Date().toISOString()` instead of `graph.metadata.generated_at`.

The spec wants per-binding reasoning (falling back to graph), and the model-provided timestamp.

**Files:**
- Modify: `src/store/ai-panel-actions.ts`

- [ ] **Step 1: Update the provenance synthesis**

In `src/store/ai-panel-actions.ts`, replace the `aiSource:` block inside the `for (const node of graph.nodes)` loop:

```ts
    const firstBinding = graph.panelBindings.find((b) => b.nodeId === node.id);
    const label = firstBinding?.label ?? node.type;
    const adjustment: Adjustment = {
      id: `${id}-${node.id}`,
      type: node.type,
      name: label,
      enabled: true,
      blendMode: 'normal',
      opacity: 1,
      params: toNumericParams(node.params),
      aiSource: {
        graphId: graph.id,
        nodeId: node.id,
        label,
        reasoning: firstBinding?.reasoning ?? graph.reasoning,
        modelName: graph.metadata.model_name ?? '',
        modelVersion: graph.metadata.model_version ?? '',
        generatedAt: graph.metadata.generated_at ?? new Date().toISOString(),
      },
    };
```

- [ ] **Step 2: Verify**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/store/ai-panel-actions.ts
git commit -m "fix(ai-panel): aiSource uses per-binding reasoning + model-provided timestamp"
```

---

## Task 8: Frontend — `addRefinedAiPanelLayer` + `resetPanelToSuggestion`

The store has `addAdjustment(layerId, adjustment)`, `updateAdjustmentMeta(layerId, adjustmentId, {blendMode|opacity|enabled|name})`, and `reorderLayers(fromIndex, toIndex)` — but NO method to update an adjustment's `params` by ID. Reset needs that. Add a small new slice method `updateAdjustmentParams(layerId, adjustmentId, params)` as part of this task.

**Files:**
- Modify: `src/store/layer-slice.ts` (add `updateAdjustmentParams`)
- Modify: `src/store/ai-panel-actions.ts`
- Create: `src/store/ai-panel-actions.test.ts`

- [ ] **Step 0: Add `updateAdjustmentParams` to the slice**

In `src/store/layer-slice.ts`, in the interface declaration (around line 107, near `updateAdjustmentMeta`), add:

```ts
  // Replace an adjustment's params map by ID
  updateAdjustmentParams: (
    layerId: string,
    adjustmentId: string,
    params: Record<string, number | Float32Array>,
  ) => void;
```

In the implementation (after `updateAdjustmentMeta` around line 213), add:

```ts
  updateAdjustmentParams: (layerId, adjustmentId, params) =>
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return;
      const adj = layer.adjustmentStack.adjustments.find((a) => a.id === adjustmentId);
      if (adj) {
        adj.params = params;
      }
    }),
```

- [ ] **Step 1: Write the failing tests**

Write `src/store/ai-panel-actions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import {
  addAiPanelLayer,
  addRefinedAiPanelLayer,
  resetPanelToSuggestion,
} from './ai-panel-actions';
import type { OperationGraph } from '@/types/operation-graph';

function makeGraph(overrides: Partial<OperationGraph> = {}): OperationGraph {
  return {
    id: 'g-1',
    userGoal: 'make it warmer',
    reasoning: 'cool tones detected',
    nodes: [
      { id: 'n1', type: 'kelvin', scope: { kind: 'global' }, params: { temperature: 5800 }, inputs: [] },
    ],
    panelBindings: [
      {
        nodeId: 'n1',
        paramKey: 'temperature',
        label: 'warm cast',
        control: 'slider',
        min: 3000,
        max: 9000,
        default: 5800,
        step: 50,
        reasoning: 'binding-level reason',
      },
    ],
    metadata: {
      model_name: 'claude-opus-4-7',
      model_version: '2026-01',
      generated_at: '2026-05-15T00:00:00Z',
    },
    ...overrides,
  };
}

beforeEach(() => {
  // Reset store between tests
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('addAiPanelLayer provenance', () => {
  it('attaches aiSource with per-binding reasoning + metadata timestamp', () => {
    addAiPanelLayer(makeGraph());
    const layer = useEditorStore.getState().layers[0];
    expect(layer.type).toBe('ai-panel');
    const adj = layer.adjustmentStack.adjustments[0];
    expect(adj.aiSource).toBeDefined();
    expect(adj.aiSource!.reasoning).toBe('binding-level reason');
    expect(adj.aiSource!.generatedAt).toBe('2026-05-15T00:00:00Z');
    expect(adj.aiSource!.modelName).toBe('claude-opus-4-7');
    expect(adj.aiSource!.modelVersion).toBe('2026-01');
    expect(adj.aiSource!.graphId).toBe('g-1');
    expect(adj.aiSource!.nodeId).toBe('n1');
    expect(adj.aiSource!.label).toBe('warm cast');
  });
});

describe('addRefinedAiPanelLayer', () => {
  it('inserts the new layer above the prior layer; prior untouched', () => {
    addAiPanelLayer(makeGraph({ id: 'g-1' }));
    const priorId = useEditorStore.getState().layers[0].id;
    const priorOrder = useEditorStore.getState().layers[0].order;

    addRefinedAiPanelLayer(priorId, makeGraph({ id: 'g-2', userGoal: 'subtler' }));

    const layers = useEditorStore.getState().layers;
    expect(layers).toHaveLength(2);
    const refined = layers.find((l) => l.operationGraph?.id === 'g-2')!;
    const prior = layers.find((l) => l.id === priorId)!;

    // Refined is above (higher order = on top of stack per project convention; verify)
    expect(refined.order).toBeGreaterThan(prior.order);
    // Prior layer's data unchanged
    expect(prior.operationGraph?.id).toBe('g-1');
    expect(prior.adjustmentStack.adjustments[0].aiSource?.graphId).toBe('g-1');
  });

  it('throws if priorLayerId is unknown', () => {
    expect(() => addRefinedAiPanelLayer('nope', makeGraph())).toThrow(/unknown/i);
  });
});

describe('resetPanelToSuggestion', () => {
  it('restores each adjustment param to its binding default', () => {
    addAiPanelLayer(makeGraph());
    const layerId = useEditorStore.getState().layers[0].id;
    const layer = useEditorStore.getState().layers[0];
    const adjId = layer.adjustmentStack.adjustments[0].id;

    // Mutate the param away from the default
    useEditorStore.getState().updateAdjustmentParams(layerId, adjId, { temperature: 9000 });
    expect(
      useEditorStore.getState().layers[0].adjustmentStack.adjustments[0].params.temperature,
    ).toBe(9000);

    resetPanelToSuggestion(layerId);

    expect(
      useEditorStore.getState().layers[0].adjustmentStack.adjustments[0].params.temperature,
    ).toBe(5800);
  });

  it('is a no-op for non-ai-panel layers', () => {
    // Plant a regular layer
    useEditorStore.getState().addLayer({
      id: 'plain',
      type: 'image',
      name: 'Plain',
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    expect(() => resetPanelToSuggestion('plain')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run — failures**

```bash
npx vitest run src/store/ai-panel-actions.test.ts
```
Expected: tests fail — `addRefinedAiPanelLayer` and `resetPanelToSuggestion` don't exist yet.

- [ ] **Step 3: Implement the two new functions**

In `src/store/ai-panel-actions.ts`, append:

```ts
/**
 * Materialise a refined OperationGraph as a NEW sibling ai-panel layer placed
 * immediately above the prior layer in the stack. The prior layer is untouched.
 *
 * Throws if `priorLayerId` is not in the store.
 */
export function addRefinedAiPanelLayer(priorLayerId: string, graph: OperationGraph): void {
  const stateBefore = useEditorStore.getState();
  const priorIndex = stateBefore.layers.findIndex((l) => l.id === priorLayerId);
  if (priorIndex === -1) {
    throw new Error(`addRefinedAiPanelLayer: unknown priorLayerId "${priorLayerId}"`);
  }

  addAiPanelLayer(graph);

  // addAiPanelLayer appended the new layer at the end of `layers`; move it
  // to just above the prior layer (priorIndex + 1).
  const newIndex = useEditorStore.getState().layers.length - 1;
  const targetIndex = priorIndex + 1;
  if (newIndex !== targetIndex) {
    useEditorStore.getState().reorderLayers(newIndex, targetIndex);
  }
}

/**
 * Restore every AI-sourced adjustment on the given ai-panel layer to its
 * binding default. Non-AI adjustments and non-ai-panel layers are ignored.
 * Recorded as a single undoable action.
 */
export function resetPanelToSuggestion(layerId: string): void {
  const store = useEditorStore.getState();
  const layer = store.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return;

  const bindingsByNode = new Map<string, typeof layer.panelBindings>();
  for (const b of layer.panelBindings) {
    const arr = bindingsByNode.get(b.nodeId) ?? [];
    arr.push(b);
    bindingsByNode.set(b.nodeId, arr);
  }

  // Group all param updates into one recordAction so it's a single undo step.
  // Lazy-imported to avoid pulling core into store-level code.
  void import('@/core/document').then(({ editorDocument }) => {
    editorDocument.recordAction('Reset to suggestion', () => {
      for (const adj of layer.adjustmentStack.adjustments) {
        const nodeId = adj.aiSource?.nodeId;
        if (!nodeId) continue;
        const bindings = bindingsByNode.get(nodeId);
        if (!bindings) continue;
        const nextParams: Record<string, number | Float32Array> = { ...adj.params };
        for (const b of bindings) {
          if (typeof b.default === 'number') nextParams[b.paramKey] = b.default;
        }
        useEditorStore.getState().updateAdjustmentParams(layerId, adj.id, nextParams);
      }
    });
  });
}
```

- [ ] **Step 4: Sanity check store APIs used**

The test and impl use `addLayer`, `addAdjustment`, `updateAdjustmentParams` (new in Step 0), and `reorderLayers(fromIndex, toIndex)`. Confirm they all resolve:

```bash
grep -nE "addLayer|addAdjustment|updateAdjustmentParams|reorderLayers" src/store/layer-slice.ts
```
Expected: 5+ matches (interface decl + impl for each).

- [ ] **Step 5: Run — tests pass**

```bash
npx vitest run src/store/ai-panel-actions.test.ts
```
Expected: all 5 tests in this file pass; total project tests = 17 + 5 = **22**.

- [ ] **Step 6: Run full check**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/store/ai-panel-actions.ts src/store/ai-panel-actions.test.ts
git commit -m "feat(ai-panel): addRefinedAiPanelLayer + resetPanelToSuggestion"
```

---

## Task 9: Frontend — `Toast` primitive

Phase 1 has no toast surface. `AiPanelHeader` needs one for refine errors. Build a tiny primitive — no Radix dep (just a positioned div + framer-motion fade).

**Files:**
- Create: `src/components/ui/Toast.tsx`

- [ ] **Step 1: Verify it doesn't already exist**

```bash
find src/components/ui -name "Toast*" 2>&1
grep -rn "useToast" src --include='*.ts' --include='*.tsx' 2>&1 | head -3
```
Expected: no results (else: read the existing file and use it instead — skip Steps 2–3).

- [ ] **Step 2: Write the primitive**

Write `src/components/ui/Toast.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ToastMessage {
  id: number;
  text: string;
  variant: 'info' | 'error';
}

let counter = 0;
const listeners = new Set<(msg: ToastMessage) => void>();

/**
 * Module-level toast emitter. Call from anywhere; the rendered ToastHost
 * (mounted once at the app root) subscribes and displays. Queue is replace-
 * latest (length 1) — the newest message wins.
 */
export const toast = {
  info(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'info' };
    listeners.forEach((l) => l(msg));
  },
  error(text: string): void {
    const msg: ToastMessage = { id: ++counter, text, variant: 'error' };
    listeners.forEach((l) => l(msg));
  },
};

/**
 * Mount once at the app root (e.g. inside `EditorProvider`).
 * Renders one absolutely-positioned toast at the bottom-centre of the viewport.
 */
export function ToastHost(): React.ReactElement {
  const [msg, setMsg] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const fn = (m: ToastMessage) => setMsg(m);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  useEffect(() => {
    if (!msg) return;
    const handle = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(handle);
  }, [msg]);

  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={`pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 glass-panel px-3 py-2 text-[11px] ${
            msg.variant === 'error' ? 'text-red-300' : 'text-text-primary'
          }`}
          role="status"
        >
          {msg.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Mount `ToastHost` once at the app root**

Read `src/components/EditorProvider.tsx` (or wherever the root scaffolding lives — `App.tsx`, `EditorDialog.tsx`):

```bash
grep -l "EditorProvider\|className=\"app\\|<EditorCanvas" src/components 2>&1 | head -3
```

Add `import { ToastHost } from '@/components/ui/Toast';` and place `<ToastHost />` as a sibling of the existing root children. The exact placement depends on the existing scaffold — pick a level above where toasts should appear (root provider is fine).

- [ ] **Step 4: Verify**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Toast.tsx src/components/EditorProvider.tsx
git commit -m "feat(ui): Toast primitive (module-level emitter + single-host)"
```

(Adjust the staged files if you mounted ToastHost elsewhere.)

---

## Task 10: Frontend — `AiPanelHeader.tsx`

Two-button bar above the bindings: **Refine…** (toggles an inline text input) and **Reset** (rewind icon).

**Files:**
- Create: `src/components/inspector/AiPanelHeader.tsx`

- [ ] **Step 1: Read `LayersPanel.tsx`** for the project's glass+icon button conventions:

```bash
grep -n "lucide-react\|className=.*glass" src/components/inspector/*.tsx | head -20
```

- [ ] **Step 2: Write the component**

Write `src/components/inspector/AiPanelHeader.tsx`:

```tsx
import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/store';
import { refinePanel } from '@/lib/ai-client';
import { addRefinedAiPanelLayer, resetPanelToSuggestion } from '@/store/ai-panel-actions';
import { toast } from '@/components/ui/Toast';

interface AiPanelHeaderProps {
  layerId: string;
  /** The session ID held by useImageContext or its consumer. Threaded through props for testability. */
  sessionId: string | null;
}

export function AiPanelHeader({ layerId, sessionId }: AiPanelHeaderProps) {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (refining) inputRef.current?.focus();
  }, [refining]);

  if (!layer || layer.type !== 'ai-panel') return null;
  const priorGraphId = layer.operationGraph?.id;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sessionId || !priorGraphId) {
      toast.error('Session unavailable. Re-open the image.');
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const graph = await refinePanel(sessionId, priorGraphId, trimmed);
      addRefinedAiPanelLayer(layerId, graph);
      setInstruction('');
      setRefining(false);
    } catch (err) {
      toast.error('Refine failed. Try again.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setRefining(false);
      setInstruction('');
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] text-text-secondary">
      {refining ? (
        <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. more subtle, only the sky"
            maxLength={500}
            disabled={busy}
            className="flex-1 rounded bg-surface-secondary/60 px-2 py-1 text-text-primary outline-none placeholder:text-text-secondary/60"
          />
          <button
            type="submit"
            disabled={busy || !instruction.trim()}
            className="rounded bg-surface-secondary/60 px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy ? '…' : 'Apply'}
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setRefining(true)}
            className="inline-flex items-center gap-1 rounded bg-surface-secondary/60 px-2 py-0.5 text-text-primary"
          >
            <Wand2 className="h-2.5 w-2.5" />
            <span>Refine…</span>
          </button>
          <button
            type="button"
            onClick={() => resetPanelToSuggestion(layerId)}
            title="Reset to model suggestion"
            className="inline-flex items-center gap-1 rounded bg-surface-secondary/60 px-2 py-0.5 text-text-primary"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            <span>Reset</span>
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

```bash
npm run check
```
Expected: exit 0 (zero errors; lint may warn but no rules broken).

- [ ] **Step 4: Commit**

```bash
git add src/components/inspector/AiPanelHeader.tsx
git commit -m "feat(inspector): AiPanelHeader with refine input + reset button"
```

---

## Task 11: Frontend — wire `AiPanelHeader` into `AiPanelSection`; enrich `ReasoningBadge`

`AiPanelSection` needs the active session ID to pass to the header. The session ID lives in `useImageContext` (Phase 1). Use the hook directly inside `AiPanelSection`.

**Files:**
- Modify: `src/components/inspector/AiPanelSection.tsx`
- Modify: `src/components/ui/ReasoningBadge.tsx`

- [ ] **Step 1: Confirm `useImageContext` exposes sessionId**

```bash
grep -n "sessionId\|session_id\|useImageContext" src/hooks/useImageContext.ts | head -10
```

If `useImageContext()` returns an object with a `sessionId` field, use it directly. If sessionId lives elsewhere (e.g. in a Zustand slice or a context), find it and adjust the wiring. The plan assumes it's available; the implementer adapts to the actual API.

- [ ] **Step 2: Update `AiPanelSection.tsx`**

Replace the contents of `src/components/inspector/AiPanelSection.tsx`:

```tsx
import type { ReactElement } from 'react';
import { useEditorStore } from '@/store';
import { useProcessingParam } from '@/lib/use-processing-param';
import { useImageContext } from '@/hooks/useImageContext';
import { AdjustmentSlider } from './AdjustmentSlider';
import { AiPanelHeader } from './AiPanelHeader';
import { ReasoningBadge } from '@/components/ui/ReasoningBadge';
import type { PanelBinding } from '@/types/operation-graph';
import type { AiSource } from '@/store/layer-slice';

interface AiPanelSectionProps { layerId: string; }

interface BindingRowProps {
  layerId: string;
  adjustmentType: string;
  binding: PanelBinding;
  aiSource: AiSource | undefined;
}

function BindingRow({ layerId, adjustmentType, binding, aiSource }: BindingRowProps) {
  const defaultNumber = typeof binding.default === 'number' ? binding.default : 0;
  const min = binding.min ?? 0;
  const max = binding.max ?? 100;
  const step = binding.step ?? 1;

  const [value, setValue] = useProcessingParam(
    layerId,
    adjustmentType,
    undefined,
    binding.paramKey,
    defaultNumber,
  );

  const reasoning = binding.reasoning ?? aiSource?.reasoning;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{binding.label}</span>
        {reasoning && (
          <ReasoningBadge
            reasoning={reasoning}
            modelName={aiSource?.modelName}
            modelVersion={aiSource?.modelVersion}
            timestamp={aiSource?.generatedAt}
          />
        )}
      </div>
      <AdjustmentSlider
        label={binding.label}
        value={value}
        min={min}
        max={max}
        step={step}
        defaultValue={defaultNumber}
        onChange={setValue}
      />
    </div>
  );
}

export function AiPanelSection({ layerId }: AiPanelSectionProps): ReactElement | null {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  const { sessionId } = useImageContext();

  if (!layer || layer.type !== 'ai-panel' || !layer.panelBindings) return null;

  const nodesById = new Map(layer.operationGraph?.nodes.map((n) => [n.id, n]) ?? []);
  const adjustmentsByNode = new Map(
    layer.adjustmentStack.adjustments
      .filter((a) => a.aiSource)
      .map((a) => [a.aiSource!.nodeId, a]),
  );

  return (
    <div className="flex flex-col">
      <AiPanelHeader layerId={layerId} sessionId={sessionId} />
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center gap-1 text-[11px] text-text-secondary">
          <span>AI suggestion:</span>
          <span className="text-text-primary">{layer.operationGraph?.userGoal ?? '—'}</span>
        </div>
        {layer.panelBindings.map((binding) => {
          const adjustmentType = nodesById.get(binding.nodeId)?.type ?? 'basic';
          const aiSource = adjustmentsByNode.get(binding.nodeId)?.aiSource;
          return (
            <BindingRow
              key={`${binding.nodeId}-${binding.paramKey}`}
              layerId={layerId}
              adjustmentType={adjustmentType}
              binding={binding}
              aiSource={aiSource}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `ReasoningBadge.tsx`**

Replace `src/components/ui/ReasoningBadge.tsx`:

```tsx
import { Sparkles } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

interface ReasoningBadgeProps {
  reasoning: string;
  modelName?: string;
  modelVersion?: string;
  timestamp?: string;
}

export function ReasoningBadge({ reasoning, modelName, modelVersion, timestamp }: ReasoningBadgeProps) {
  const meta = [modelName, modelVersion, timestamp].filter(Boolean).join(' · ');
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-[14px] items-center gap-px rounded-[6px] bg-surface-secondary/60 px-1 text-[10px] text-text-secondary"
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>AI</span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="glass-panel max-w-[240px] px-2 py-1 text-[11px] text-text-primary"
          >
            <p>{reasoning}</p>
            {meta && <p className="mt-1 text-[10px] text-text-secondary">{meta}</p>}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/AiPanelSection.tsx src/components/ui/ReasoningBadge.tsx
git commit -m "feat(inspector): wire AiPanelHeader; ReasoningBadge surfaces modelVersion"
```

---

## Task 12: Frontend — round-trip `aiSource` through serializer + session-storage

`aiSource` is currently dropped by `src/core/serializer.ts` and `src/core/session-storage.ts` (their `serializeLayer` helpers explicitly enumerate adjustment fields). Add it to both.

**Files:**
- Modify: `src/core/serializer.ts`
- Modify: `src/core/session-storage.ts`

- [ ] **Step 1: Update `serializer.ts`**

In `src/core/serializer.ts`, find the `SerializableAdjustment` interface (around the top of the file). Add `aiSource?: AiSource`:

```ts
import type { Layer, Adjustment, AiSource } from '@/store/layer-slice';
// ...
interface SerializableAdjustment {
  id: string;
  type: Adjustment['type'];
  name: string;
  enabled: boolean;
  blendMode: Adjustment['blendMode'];
  opacity: number;
  params: SerializableParams;
  aiSource?: AiSource;
}
```

Update `serializeLayer` (the inner per-adjustment `.map(...)` block) to include `aiSource: adj.aiSource`. Update `deserializeLayer` symmetrically to include `aiSource: adj.aiSource`.

- [ ] **Step 2: Update `session-storage.ts`**

Same change in `src/core/session-storage.ts`:
- Add `aiSource?: AiSource` to its local `SerializableAdjustment`.
- Add `aiSource: adj.aiSource` to both `serializeLayer` and `deserializeLayer`.
- Import `AiSource` from `@/store/layer-slice` (or alias the existing import line).

- [ ] **Step 3: Verify**

```bash
npm run check
```
Expected: exit 0.

- [ ] **Step 4: Add a quick round-trip assertion** in `src/core/history-tree.test.ts` is not appropriate — those tests are about the tree, not serialisation. Instead, eyeball the change manually: open `.edp` after the smoke test and confirm `aiSource` is in the manifest JSON. (No new unit test in this task — would require DOM/IndexedDB polyfills out of scope.)

- [ ] **Step 5: Commit**

```bash
git add src/core/serializer.ts src/core/session-storage.ts
git commit -m "feat(persistence): round-trip aiSource through serializer + session-storage"
```

---

## Task 13: Manual smoke + exit criteria

The browser smoke is user-driven. Automated exit criteria (`npm run check`, vitest counts, cache-marker test, refine endpoint tests) are already covered by the per-task verification.

- [ ] **Step 1: Run the full automated gate**

```bash
npm run check
cd backend && .venv/bin/pytest -q
```
Expected: both exit 0. Vitest: 22 passed (17 from Phase 2 + 5 from Task 8). Pytest: prior baseline + Task 1 (4) + Task 3 (2) + Task 5 (7) = +13.

- [ ] **Step 2: Boot dev servers** (user-driven)

```bash
npm run dev:backend &
npm run dev &
```

- [ ] **Step 3: Browser smoke checklist** (user-driven)

- [ ] Open image → "analysing → ready" pill.
- [ ] Cmd+K "make it warmer" → panel appears with reasoning badges. Hover any badge: reasoning + model name + version + timestamp shown.
- [ ] Drag a slider; image updates. Cmd+Z reverts to model defaults. Cmd+Shift+Z restores.
- [ ] Toggle layer visibility in LayersPanel → image flips between "with suggestion" and "without".
- [ ] Click Reset on panel header → all sliders snap to defaults in one undoable step.
- [ ] Click Refine, type "more subtle" → new panel layer appears above the original; both visible.
- [ ] Cmd+K "darken the background" → second AI suggestion appears as a third panel. All three coexist.
- [ ] Save `.edp`, reload, open: `aiSource` survives (verify by hovering a reasoning badge after reload — model identity present).
- [ ] Backend log: 5 sequential `/api/panel` calls in one session show `cache_read > 0` on calls 2–5 (≥80% ratio).

- [ ] **Step 4: If everything passes, tag the phase exit**

```bash
git tag -a phase-3-exit -m "Phase 3: AI completeness — refine, provenance, three-granularity revert, cache verification"
```

---

## Spec coverage check

| Spec deliverable (§4 P3 / spec §3) | Plan task |
|---|---|
| Two-region inspector layout | Already in Phase 1 (verified, unchanged) |
| Multi-panel coexistence (each panel call creates a new ai-panel layer) | Already in Phase 1 (`addAiPanelLayer` mints fresh IDs) |
| `aiSource` provenance on Adjustment | Phase 1 partially; Task 7 fixes source-of-truth; Task 12 round-trips |
| Reasoning badge primitive | Phase 1 partially; Task 11 adds `modelVersion` |
| Three revert granularities | Task 8 (`resetPanelToSuggestion`); double-click already in Phase 1; visibility toggle in LayersPanel; Cmd+Z via Phase 2 |
| Goal-relevant labels | Phase 1 (PanelBinding.label) — no work |
| `/api/refine` endpoint | Task 5 |
| "Reset to model suggestion" | Task 8 + Task 10 (button) |
| Image context reuse verified | Task 3 (structural test) + Task 4 (logging) |
| Backend session graph cache | Task 1 |
| Refine path on Anthropic client | Task 2 |
| Toast surface for refine errors | Task 9 |

| Spec exit criterion | Plan coverage |
|---|---|
| Two AI panels visible simultaneously | Task 13 smoke |
| Hover tooltip shows reasoning + model identity | Task 11 (data path) + Task 13 smoke |
| Reset / hide / undo all work differently | Task 8 + LayersPanel (Phase 1) + Phase 2 — Task 13 smoke |
| Cache-hit ≥80% across 5 calls | Task 4 (logging) + Task 13 smoke |
| `npm run check` passes | Per-task gates + Task 13 |
