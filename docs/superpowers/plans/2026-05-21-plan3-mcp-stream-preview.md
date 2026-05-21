# Plan 3 — MCP Wire Format + State Stream + Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plans 1 and 2 are complete and merged. The `BackendToolRegistry`, every widget-lifecycle tool, all 9 fused-tool templates, and `EnrichedImageContext` v2 are working over REST.

**Goal:** Expose the registry over real MCP wire protocol so external Claude clients can drive the editor. Ship the SSE state stream so the frontend (and any MCP client) sees concurrent changes live. Add a CPU preview renderer + `preview_widget` so widgets can be evaluated server-side. Replace the legacy `/api/panel` and `/api/refine` with thin shims.

**Architecture:** A new `app/mcp/` package mounts a streamable-HTTP MCP server at `/mcp`. Session pairing happens through an `editor_session_id` header on the MCP `initialize` request. Per-MCP-session rate limiting and a notification channel that converts `StateEvent`s into MCP notifications. The SSE state stream lives at `/api/state/{sid}/events`; a one-shot `/api/state/{sid}` returns a `SessionStateSnapshot` with the server-projected `OperationGraph`. The preview renderer is a numpy/OpenCV approximation that covers `kelvin`, `basic`, `curves`, `levels`; unsupported nodes get `kind="none"` previews.

**Tech Stack:** `mcp` Python SDK (`pip install mcp`) for the wire encoding, `sse-starlette` (or hand-rolled `EventSourceResponse`) for SSE, numpy + Pillow for CPU rendering, existing FastAPI mount.

---

## File Structure

**New files:**
- `backend/app/mcp/__init__.py`
- `backend/app/mcp/server.py` — streamable-HTTP MCP endpoint, dispatches `initialize`, `tools/list`, `tools/call`, notifications.
- `backend/app/mcp/session.py` — MCP transport session ↔ editor session_id mapping.
- `backend/app/mcp/rate_limit.py` — per-MCP-session token bucket (30 calls/minute default).
- `backend/app/api/state.py` — `GET /api/state/{sid}` snapshot + `GET /api/state/{sid}/events` SSE.
- `backend/app/state/snapshot.py` — `compute_snapshot(doc) → SessionStateSnapshot`.
- `backend/app/state/preview_renderer.py` — CPU approximation of WebGL pipeline for `kelvin` / `basic` / `curves` / `levels`.
- `backend/app/tools/atomic/preview_widget.py` — `preview_widget(widget_id, max_dim=256) → jpeg_b64`.
- Test files mirroring each module under `backend/tests/`.

**Modified files:**
- `backend/app/api/panel.py` — collapse into a thin shim around `tools.propose_widget`. Marks itself deprecated via a `Deprecation` header.
- `backend/app/api/refine.py` — same treatment, around `refine_widget`.
- `backend/app/api/__init__.py` — mount `state.router` and the MCP transport.
- `backend/app/main.py` — mount the MCP server at `/mcp` (separate from the `/api` prefix).
- `backend/app/api/deps.py` — instantiate the rate limiter; expose accessors for the snapshot computer + preview renderer.
- `backend/app/tools/atomic/__init__.py` — register `preview_widget`.
- `backend/pyproject.toml` (or `backend/requirements.txt`) — add `mcp` and `sse-starlette`.

**Untouched:** Plan 1's atomic tool surface, Plan 2's widget-lifecycle tools and fused-tool templates, the frontend. Frontend integration is its own follow-up plan beyond this scope; Plan 3 makes the contract available.

---

## Conventions reused from Plans 1 and 2

- TDD pattern, `pytest backend/tests/<path> -v`, Conventional Commits, `Co-Authored-By` trailer.
- Fake `AnthropicClient` and `SamClient` reused as before.
- Test files for the SSE stream use `httpx.AsyncClient` with FastAPI lifespan in test mode.

---

## Task 1: Add MCP + SSE dependencies

**Files:**
- Modify: `backend/pyproject.toml` and `backend/requirements.txt`.

- [ ] **Step 1: Add dependencies**

Edit `backend/pyproject.toml`:

```toml
[project]
dependencies = [
  # ...existing...
  "mcp>=1.0.0",
  "sse-starlette>=2.1.0",
]
```

Append to `backend/requirements.txt`:

```
mcp>=1.0.0
sse-starlette>=2.1.0
```

- [ ] **Step 2: Install**

```bash
cd backend && pip install -r requirements.txt
```

Expected: both packages install.

- [ ] **Step 3: Smoke-test the imports**

```bash
python -c "import mcp; from sse_starlette.sse import EventSourceResponse; print('ok')"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/pyproject.toml backend/requirements.txt
git commit -m "$(cat <<'EOF'
chore(deps): add mcp + sse-starlette for Plan 3

mcp drives the wire-format MCP server; sse-starlette gives FastAPI an
EventSourceResponse helper for the state stream.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `SessionStateSnapshot` and projection accessor

**Files:**
- Create: `backend/app/state/snapshot.py`
- Test: `backend/tests/state/test_snapshot.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_snapshot.py
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.document import SessionDocument
from app.state.snapshot import SessionStateSnapshot, compute_snapshot


def _widget(wid: str) -> Widget:
    return Widget(
        id=wid, intent=f"i-{wid}",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id=f"n_{wid}", type="kelvin", params={"temperature": 6500},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id=wid,
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="T", control_type="slider",
            target=NodeParamTarget(node_id=f"n_{wid}", param_key="temperature"),
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": 3000, "max": 9000, "step": 50}
            ),
            value=6500, default=5500,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def test_snapshot_carries_widgets_and_projection() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1"))
    snap = compute_snapshot(doc)
    assert isinstance(snap, SessionStateSnapshot)
    assert snap.session_id == "s1"
    assert len(snap.widgets) == 1
    assert len(snap.operation_graph.nodes) == 1
    assert snap.revision == doc.revision


def test_snapshot_masks_index_summarises() -> None:
    from app.schemas.widget import MaskRecord
    doc = SessionDocument(session_id="s1")
    doc.masks["m_1"] = MaskRecord(
        id="m_1", width=10, height=10, png_b64="aGVsbG8=",
        source="sam_point", label=None,
    )
    snap = compute_snapshot(doc)
    assert any(m["id"] == "m_1" for m in snap.masks_index)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/state/test_snapshot.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/state/snapshot.py
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.operation_graph import OperationGraph
from app.schemas.widget import Widget
from app.state.document import SessionDocument
from app.state.operations import project_to_graph


class SessionStateSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)
    session_id: str
    image_context: EnrichedImageContext | None
    widgets: list[Widget]
    masks_index: list[dict]
    operation_graph: OperationGraph
    revision: int


def compute_snapshot(doc: SessionDocument) -> SessionStateSnapshot:
    return SessionStateSnapshot(
        session_id=doc.session_id,
        image_context=doc.image_context if isinstance(doc.image_context, EnrichedImageContext) else None,
        widgets=[doc.widgets[wid] for wid in doc.widget_order],
        masks_index=[
            {"id": m.id, "width": m.width, "height": m.height,
             "source": m.source, "label": m.label}
            for m in doc.masks.values()
        ],
        operation_graph=project_to_graph(doc),
        revision=doc.revision,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/state/test_snapshot.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/snapshot.py backend/tests/state/test_snapshot.py
git commit -m "$(cat <<'EOF'
feat(state): SessionStateSnapshot + compute_snapshot

Combines widget list, masks index, EnrichedImageContext, and the
projected OperationGraph into a single typed snapshot the frontend
(and MCP clients) can consume on connect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: State endpoints — snapshot + SSE

**Files:**
- Create: `backend/app/api/state.py`
- Modify: `backend/app/api/__init__.py`
- Test: `backend/tests/api/test_state.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/api/test_state.py
import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview


@pytest.mark.asyncio
async def test_state_snapshot_returns_revision() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        r = await ac.get(f"/api/state/{sid}")
        assert r.status_code == 200
        body = r.json()
        assert body["session_id"] == sid
        assert body["revision"] == 0
        assert body["widgets"] == []


@pytest.mark.asyncio
async def test_state_sse_delivers_widget_created() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test", timeout=2.0) as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]

        # Start SSE GET in the background.
        async def consume():
            async with ac.stream("GET", f"/api/state/{sid}/events") as r:
                async for raw in r.aiter_lines():
                    if not raw or not raw.startswith("data: "):
                        continue
                    payload = json.loads(raw[6:])
                    if payload.get("kind") == "widget.created":
                        return payload
                return None

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.1)
        # Push a widget directly so we don't depend on Claude.
        doc = deps.get_session_store().get_document(sid)
        doc.add_widget(Widget(
            id="w_1", intent="warm",
            scope=Scope.model_validate({"kind": "global"}),
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
            preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        ))
        deps.get_event_bus().publish(sid, doc.history[-1])
        out = await asyncio.wait_for(task, timeout=2.0)
        assert out is not None
        assert out["kind"] == "widget.created"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/api/test_state.py -v`
Expected: 404 on `/api/state/{sid}`.

- [ ] **Step 3: Implement**

```python
# backend/app/api/state.py
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.state.snapshot import SessionStateSnapshot, compute_snapshot

router = APIRouter()


def _store() -> SessionStore:
    return deps.get_session_store()


def _bus() -> EventBus:
    return deps.get_event_bus()


@router.get("/state/{sid}", response_model=SessionStateSnapshot)
async def state_snapshot(sid: str) -> SessionStateSnapshot:
    try:
        doc = _store().get_document(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return compute_snapshot(doc)


@router.get("/state/{sid}/events")
async def state_events(sid: str):
    try:
        _store().get(sid)  # validate the session exists
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    bus = _bus()
    queue = bus.subscribe(sid)

    async def gen():
        try:
            while True:
                ev = await queue.get()
                yield {"event": ev.kind, "data": json.dumps({
                    "revision": ev.revision,
                    "kind": ev.kind,
                    "payload": ev.payload,
                    "emitted_at": ev.emitted_at.isoformat(),
                })}
        except asyncio.CancelledError:
            return
        finally:
            bus.unsubscribe(sid, queue)

    return EventSourceResponse(gen())
```

Mount in `api/__init__.py`:

```python
from . import analyze, panel, refine, segment, session, state, tools_rest

router.include_router(state.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/api/test_state.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/state.py backend/app/api/__init__.py backend/tests/api/test_state.py
git commit -m "$(cat <<'EOF'
feat(api): state snapshot + SSE event stream

GET /api/state/{sid} returns a SessionStateSnapshot with the server-
projected OperationGraph; GET /api/state/{sid}/events streams StateEvents
as Server-Sent Events. Both are session-scoped via the per-session bus.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: MCP rate limiter

**Files:**
- Create: `backend/app/mcp/__init__.py` (empty), `backend/app/mcp/rate_limit.py`
- Test: `backend/tests/mcp/__init__.py` (empty), `backend/tests/mcp/test_rate_limit.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/mcp/test_rate_limit.py
import time

from app.mcp.rate_limit import RateLimiter


def test_under_limit_passes() -> None:
    rl = RateLimiter(rate_per_minute=30)
    for _ in range(5):
        assert rl.try_consume("s1") is True


def test_over_limit_blocks() -> None:
    rl = RateLimiter(rate_per_minute=2, capacity=2)
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is False


def test_isolated_per_session() -> None:
    rl = RateLimiter(rate_per_minute=1, capacity=1)
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s2") is True
    assert rl.try_consume("s1") is False


def test_refill_after_time() -> None:
    rl = RateLimiter(rate_per_minute=60, capacity=1)  # 1 per second
    assert rl.try_consume("s1") is True
    assert rl.try_consume("s1") is False
    time.sleep(1.1)
    assert rl.try_consume("s1") is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/mcp/test_rate_limit.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/mcp/rate_limit.py
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from threading import Lock


@dataclass
class _Bucket:
    tokens: float = 0.0
    last_refill: float = field(default_factory=time.monotonic)


class RateLimiter:
    """Per-session token-bucket rate limiter for MCP tool calls."""

    def __init__(self, rate_per_minute: int, capacity: int | None = None) -> None:
        self._refill_per_sec = rate_per_minute / 60.0
        self._capacity = float(capacity if capacity is not None else rate_per_minute)
        self._buckets: dict[str, _Bucket] = defaultdict(_Bucket)
        self._lock = Lock()

    def try_consume(self, session_id: str, n: float = 1.0) -> bool:
        with self._lock:
            now = time.monotonic()
            b = self._buckets[session_id]
            if b.tokens == 0.0 and b.last_refill == 0.0:
                b.tokens = self._capacity
            elapsed = now - b.last_refill
            b.tokens = min(self._capacity, b.tokens + elapsed * self._refill_per_sec)
            b.last_refill = now
            # Special case: brand-new bucket starts full.
            if b.tokens < self._capacity and elapsed >= 60.0:
                b.tokens = self._capacity
            # Initialise first-use bucket at capacity.
            if elapsed > 60.0 * 60.0:  # untouched: treat as fresh
                b.tokens = self._capacity
            # If this is the FIRST consume on this bucket, top up so we don't reject the first call.
            if b.tokens == 0.0:
                b.tokens = self._capacity
            if b.tokens >= n:
                b.tokens -= n
                return True
            return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/mcp/test_rate_limit.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp/__init__.py backend/app/mcp/rate_limit.py backend/tests/mcp/__init__.py backend/tests/mcp/test_rate_limit.py
git commit -m "$(cat <<'EOF'
feat(mcp): per-session token-bucket rate limiter

Default 30 calls/minute per MCP session. Used by mcp/server.py to keep
an errant external Claude from melting the Anthropic budget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MCP session pairing

**Files:**
- Create: `backend/app/mcp/session.py`
- Test: `backend/tests/mcp/test_session.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/mcp/test_session.py
import pytest

from app.mcp.session import MCPSessionRegistry, MCPSessionNotPaired


def test_pair_and_lookup() -> None:
    reg = MCPSessionRegistry()
    reg.pair("mcp-1", "editor-sid")
    assert reg.editor_session_id("mcp-1") == "editor-sid"


def test_unpaired_raises() -> None:
    reg = MCPSessionRegistry()
    with pytest.raises(MCPSessionNotPaired):
        reg.editor_session_id("nope")


def test_unpair() -> None:
    reg = MCPSessionRegistry()
    reg.pair("mcp-1", "editor-sid")
    reg.unpair("mcp-1")
    with pytest.raises(MCPSessionNotPaired):
        reg.editor_session_id("mcp-1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/mcp/test_session.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/mcp/session.py
from __future__ import annotations

from threading import Lock


class MCPSessionNotPaired(KeyError):
    pass


class MCPSessionRegistry:
    """Maps an MCP transport session id (assigned by the wire layer) to an
    editor session_id (the actual document the MCP client is editing)."""

    def __init__(self) -> None:
        self._pairs: dict[str, str] = {}
        self._lock = Lock()

    def pair(self, mcp_session_id: str, editor_session_id: str) -> None:
        with self._lock:
            self._pairs[mcp_session_id] = editor_session_id

    def unpair(self, mcp_session_id: str) -> None:
        with self._lock:
            self._pairs.pop(mcp_session_id, None)

    def editor_session_id(self, mcp_session_id: str) -> str:
        with self._lock:
            if mcp_session_id not in self._pairs:
                raise MCPSessionNotPaired(mcp_session_id)
            return self._pairs[mcp_session_id]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/mcp/test_session.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp/session.py backend/tests/mcp/test_session.py
git commit -m "$(cat <<'EOF'
feat(mcp): MCP session ↔ editor session pairing

Thin registry: an MCP transport session_id maps to one editor session_id.
mcp/server.py reads this map on tools/call dispatch to know which document
the call mutates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: MCP server — `initialize`, `tools/list`, `tools/call`

**Files:**
- Create: `backend/app/mcp/server.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/mcp/test_server.py`

The MCP Python SDK exposes a streamable-HTTP server. We adapt it to forward `tools/call` to the existing `BackendToolRegistry.invoke()`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/mcp/test_server.py
import json

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_initialize_returns_server_info() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Bootstrap an editor session first.
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        r = await ac.post(
            "/mcp",
            headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}},
            },
        )
        assert r.status_code == 200
        body = r.json()
        assert body["result"]["serverInfo"]["name"] == "editor-mcp"


@pytest.mark.asyncio
async def test_tools_list_returns_registered_tools() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        # initialize
        await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
        )
        r = await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        )
        names = {t["name"] for t in r.json()["result"]["tools"]}
        assert "get_image_context" in names
        assert "propose_widget" in names
        # set_widget_param must be REST-only.
        assert "set_widget_param" not in names


@pytest.mark.asyncio
async def test_tools_call_invokes_registry() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                  "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}},
        )
        r = await ac.post(
            "/mcp", headers={"x-editor-session-id": sid, "content-type": "application/json"},
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                  "params": {"name": "list_widgets", "arguments": {}}},
        )
        result = r.json()["result"]
        assert result["content"][0]["type"] == "text"
        envelope = json.loads(result["content"][0]["text"])
        assert envelope["ok"] is True
        assert envelope["output"]["widgets"] == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/mcp/test_server.py -v`
Expected: 404 on `/mcp`.

- [ ] **Step 3: Implement**

```python
# backend/app/mcp/server.py
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from app.api import deps
from app.mcp.rate_limit import RateLimiter
from app.mcp.session import MCPSessionNotPaired, MCPSessionRegistry
from app.tools.registry import BackendToolRegistry

router = APIRouter()


_session_registry = MCPSessionRegistry()
_rate_limiter = RateLimiter(rate_per_minute=30)


def get_mcp_session_registry() -> MCPSessionRegistry:
    return _session_registry


def get_mcp_rate_limiter() -> RateLimiter:
    return _rate_limiter


_SERVER_NAME = "editor-mcp"
_SERVER_VERSION = "0.1.0"
_PROTOCOL_VERSION = "2025-06-18"


class JSONRPCRequest(BaseModel):
    jsonrpc: str
    id: int | str | None = None
    method: str
    params: dict | None = None


def _jsonrpc_result(req_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _jsonrpc_error(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _serialise_tool(tool) -> dict:
    return {
        "name": tool.name,
        "description": (tool.description + (f"\n\nUsage: {tool.usage}" if tool.usage else "")),
        "inputSchema": tool.input_schema.model_json_schema(),
    }


@router.post("/mcp")
async def mcp_dispatch(
    req: Request,
    x_editor_session_id: str | None = Header(default=None),
) -> dict:
    try:
        body = JSONRPCRequest.model_validate(await req.json())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid JSON-RPC: {exc}")
    method = body.method
    params = body.params or {}
    req_id = body.id

    if method == "initialize":
        # The wire-level session id is the editor session id we paired with.
        if x_editor_session_id:
            _session_registry.pair(x_editor_session_id, x_editor_session_id)
        return _jsonrpc_result(req_id, {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": _SERVER_NAME, "version": _SERVER_VERSION},
        })

    if method == "tools/list":
        registry: BackendToolRegistry = deps.get_tool_registry()
        tools = [_serialise_tool(t) for t in registry.list_for("mcp")]
        return _jsonrpc_result(req_id, {"tools": tools})

    if method == "tools/call":
        if x_editor_session_id is None:
            return _jsonrpc_error(req_id, -32602, "x-editor-session-id header required")
        try:
            editor_sid = _session_registry.editor_session_id(x_editor_session_id)
        except MCPSessionNotPaired:
            return _jsonrpc_error(req_id, -32602, "MCP session not paired — call initialize first")
        if not _rate_limiter.try_consume(editor_sid):
            return _jsonrpc_error(req_id, -32000, "rate limited")
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if not isinstance(name, str):
            return _jsonrpc_error(req_id, -32602, "name must be a string")
        registry = deps.get_tool_registry()
        envelope = await registry.invoke(name=name, session_id=editor_sid, raw_input=arguments)
        return _jsonrpc_result(req_id, {
            "content": [{"type": "text", "text": envelope.model_dump_json()}],
            "isError": not envelope.ok,
        })

    if method == "notifications/initialized":
        return _jsonrpc_result(req_id, {})

    return _jsonrpc_error(req_id, -32601, f"method not found: {method}")
```

Mount in `main.py`:

```python
# backend/app/main.py — modify
from .mcp.server import router as mcp_router

def create_app() -> FastAPI:
    # ...existing body up through app.include_router(api_router)...
    app.include_router(mcp_router)  # mounts /mcp
    # ...health endpoint unchanged...
    return app
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/mcp/test_server.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/mcp/server.py backend/app/main.py backend/tests/mcp/test_server.py
git commit -m "$(cat <<'EOF'
feat(mcp): /mcp dispatcher — initialize, tools/list, tools/call

Minimal JSON-RPC framing over HTTP. Forwards tools/call to
BackendToolRegistry.invoke. set_widget_param stays REST-only via
the registry's expose_mcp filter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: CPU preview renderer

**Files:**
- Create: `backend/app/state/preview_renderer.py`
- Test: `backend/tests/state/test_preview_renderer.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_preview_renderer.py
import io

import numpy as np
import pytest
from PIL import Image

from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.preview_renderer import render_widget_preview


def _grey_image(size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), (128, 128, 128)).save(buf, format="JPEG")
    return buf.getvalue()


def _kelvin_widget(temperature: float) -> Widget:
    return Widget(
        id="w_k", intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id="n_k", type="kelvin", params={"temperature": temperature},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id="w_k",
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="T",
            control_type="slider",
            target=NodeParamTarget(node_id="n_k", param_key="temperature"),
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            value=temperature, default=0,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def test_warm_kelvin_pushes_red_higher() -> None:
    img = _grey_image(64)
    out_b64 = render_widget_preview(img, "image/jpeg", _kelvin_widget(800.0), max_dim=64)
    assert out_b64 is not None
    import base64
    raw = base64.b64decode(out_b64)
    rendered = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    # Warm kelvin should raise R relative to B; original is neutral grey.
    assert rendered[:, :, 0].mean() > rendered[:, :, 2].mean()


def test_unsupported_node_returns_none() -> None:
    w = _kelvin_widget(800.0)
    w.nodes[0].type = "weird_filter_no_one_supports"
    out = render_widget_preview(_grey_image(32), "image/jpeg", w, max_dim=32)
    assert out is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/state/test_preview_renderer.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/state/preview_renderer.py
from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from app.schemas.widget import Widget

_SUPPORTED_NODE_TYPES = {"kelvin", "basic", "curves", "levels"}


def render_widget_preview(
    image_bytes: bytes,
    mime_type: str,
    widget: Widget,
    max_dim: int = 256,
) -> str | None:
    """CPU approximation of the WebGL pipeline for thumbnail purposes.

    Returns a base64 JPEG, or None if any node uses an unsupported type
    (caller should fall back to no preview)."""
    if any(n.type not in _SUPPORTED_NODE_TYPES for n in widget.nodes):
        return None

    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    # Downscale for speed.
    img.thumbnail((max_dim, max_dim), Image.BILINEAR)
    arr = np.array(img).astype(np.float32) / 255.0  # [0, 1]

    for n in widget.nodes:
        if n.type == "kelvin":
            arr = _apply_kelvin(arr, n.params.get("temperature", 0))
        elif n.type == "basic":
            arr = _apply_basic(arr, n.params)
        elif n.type == "curves":
            arr = _apply_curves(arr, n.params)
        elif n.type == "levels":
            arr = _apply_levels(arr, n.params)

    arr = np.clip(arr, 0.0, 1.0)
    out = (arr * 255.0).astype(np.uint8)
    out_img = Image.fromarray(out, mode="RGB")
    buf = io.BytesIO()
    out_img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _apply_kelvin(arr: np.ndarray, temperature_offset: float) -> np.ndarray:
    # Linear approximation: positive offset warms (boost R, dampen B), negative cools.
    # Range maps from [-1200, 1200] to about [-0.15, +0.15] of channel shift.
    k = float(temperature_offset) / 1200.0 * 0.15
    arr = arr.copy()
    arr[:, :, 0] += k
    arr[:, :, 2] -= k
    return arr


def _apply_basic(arr: np.ndarray, params: dict) -> np.ndarray:
    # exposure (stops, [-2..2]) → linear gain
    exposure = float(params.get("exposure", 0.0))
    if exposure != 0.0:
        arr = arr * (2.0 ** exposure)
    # contrast ([-100..100]) → S-curve around 0.5 with strength scaled
    contrast = float(params.get("contrast", 0.0))
    if contrast != 0.0:
        amount = contrast / 100.0
        arr = (arr - 0.5) * (1.0 + amount) + 0.5
    # highlights / shadows / whites / blacks — linear mixes with anchored ranges.
    highlights = float(params.get("highlights", 0.0)) / 100.0
    shadows = float(params.get("shadows", 0.0)) / 100.0
    if highlights != 0.0:
        mask = np.clip((arr - 0.6) / 0.4, 0.0, 1.0)
        arr = arr + mask * highlights * 0.3
    if shadows != 0.0:
        mask = np.clip((0.4 - arr) / 0.4, 0.0, 1.0)
        arr = arr + mask * shadows * 0.3
    whites = float(params.get("whites", 0.0)) / 100.0
    if whites != 0.0:
        arr = arr + whites * 0.1
    blacks = float(params.get("blacks", 0.0)) / 100.0
    if blacks != 0.0:
        arr = arr - blacks * 0.1
    # saturation / vibrance — applied in HSV-ish space.
    saturation = float(params.get("saturation", 0.0)) / 100.0
    if saturation != 0.0:
        grey = arr.mean(axis=2, keepdims=True)
        arr = grey + (arr - grey) * (1.0 + saturation)
    return arr


def _apply_curves(arr: np.ndarray, params: dict) -> np.ndarray:
    points = params.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return arr
    pts = [(float(p[0]), float(p[1])) for p in points if isinstance(p, (list, tuple)) and len(p) == 2]
    pts.sort()
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    # Linear interpolation; clamped at endpoints.
    luma = arr.mean(axis=2)
    new_luma = np.interp(luma, xs, ys)
    ratio = np.where(luma > 1e-6, new_luma / np.maximum(luma, 1e-6), 1.0)
    return arr * ratio[..., None]


def _apply_levels(arr: np.ndarray, params: dict) -> np.ndarray:
    black = float(params.get("black", 0.0)) / 255.0
    white = float(params.get("white", 255.0)) / 255.0
    gamma = float(params.get("gamma", 1.0))
    if white <= black:
        return arr
    arr = np.clip((arr - black) / max(1e-6, white - black), 0.0, 1.0)
    if gamma != 1.0:
        arr = arr ** (1.0 / max(1e-3, gamma))
    return arr
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/state/test_preview_renderer.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/preview_renderer.py backend/tests/state/test_preview_renderer.py
git commit -m "$(cat <<'EOF'
feat(state): CPU preview renderer for kelvin / basic / curves / levels

Numpy-based approximation good enough for 256-px thumbnails. Unsupported
node types (LUT, complex filters) cause render_widget_preview to return
None so the caller can fall back to no preview rather than a wrong one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `preview_widget` tool

**Files:**
- Create: `backend/app/tools/atomic/preview_widget.py`
- Modify: `backend/app/tools/atomic/__init__.py`
- Test: `backend/tests/tools/test_preview_widget.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_preview_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.tools.atomic.preview_widget import PreviewWidgetTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(PreviewWidgetTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("preview_widget", None)


def test_preview_returns_base64_jpeg(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (64, 64), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(Widget(
        id="w_1", intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id="n_1", type="kelvin", params={"temperature": 800},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id="w_1",
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="T", control_type="slider",
            target=NodeParamTarget(node_id="n_1", param_key="temperature"),
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            value=800, default=0,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    ))
    body = client.post(
        "/api/tools/preview_widget",
        json={"session_id": sid, "input": {"widget_id": "w_1", "max_dim": 64}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["mime_type"] == "image/jpeg"
    assert body["output"]["image_b64"] is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_preview_widget.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/atomic/preview_widget.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.state.preview_renderer import render_widget_preview
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    max_dim: int = Field(default=256, ge=32, le=1024)


class _Output(BaseModel):
    mime_type: str
    image_b64: str | None = None
    reason: str | None = None


class PreviewWidgetTool(BackendTool[_Input, _Output]):
    name = "preview_widget"
    kind = "query"
    description = (
        "Render a small JPEG preview of the widget applied to the image at its current "
        "binding values. CPU pipeline approximation — limited to kelvin / basic / curves / levels."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        widget = doc.widgets.get(input.widget_id)
        if widget is None:
            raise _UnknownWidget(input.widget_id)
        b64 = render_widget_preview(doc.image_bytes, doc.mime_type, widget, max_dim=input.max_dim)
        if b64 is None:
            return _Output(mime_type="image/jpeg", image_b64=None, reason="unsupported_node_type")
        return _Output(mime_type="image/jpeg", image_b64=b64)
```

Register in `tools/atomic/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_preview_widget.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/preview_widget.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_preview_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): preview_widget — server-rendered thumbnail

Backend renders a small JPEG of the widget applied to the image and
returns base64. Unsupported node types yield image_b64=None +
reason='unsupported_node_type' so callers handle the no-preview case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Collapse `/api/panel` and `/api/refine` into shims

**Files:**
- Modify: `backend/app/api/panel.py`, `backend/app/api/refine.py`
- Test: ensure `backend/tests/test_panel_endpoint.py` and `backend/tests/test_refine.py` still pass.

- [ ] **Step 1: Verify existing tests pass with the current implementations**

Run: `pytest backend/tests/test_panel_endpoint.py backend/tests/test_refine.py -v`
Expected: all passing (Plans 1+2 must not have broken these).

- [ ] **Step 2: Rewrite `panel.py` as a shim**

```python
# backend/app/api/panel.py — full replacement
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionNotFound, SessionStore
from app.state.operations import project_to_graph

router = APIRouter()


class PanelRequest(BaseModel):
    session_id: str
    user_goal: str


@router.post("/panel", response_model=OperationGraph)
async def panel(
    body: PanelRequest,
    response: Response,
    store: SessionStore = Depends(deps.get_session_store),
) -> OperationGraph:
    """Deprecated shim. Calls propose_widget(intent=user_goal, scope=global)
    and returns the resulting projected OperationGraph."""
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "see /api/tools/propose_widget"
    registry = deps.get_tool_registry()
    envelope = await registry.invoke(
        name="propose_widget", session_id=body.session_id,
        raw_input={"intent": body.user_goal, "scope": {"kind": "global"}, "prompt": body.user_goal},
    )
    if not envelope.ok:
        # Map common envelope errors to HTTP for legacy clients.
        if envelope.error and envelope.error.code == "missing_session":
            raise HTTPException(status_code=404, detail=envelope.error.message)
        raise HTTPException(status_code=502, detail=envelope.error.message if envelope.error else "panel failed")
    # Return the projected graph from the document.
    try:
        doc = store.get_document(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return project_to_graph(doc)
```

- [ ] **Step 3: Rewrite `refine.py` similarly**

```python
# backend/app/api/refine.py — full replacement
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionNotFound, SessionStore
from app.state.operations import project_to_graph

router = APIRouter()


class RefineRequest(BaseModel):
    session_id: str
    prior_graph_id: str
    instruction: str = Field(..., min_length=1, max_length=500)


@router.post("/refine", response_model=OperationGraph)
async def refine(
    body: RefineRequest,
    response: Response,
    store: SessionStore = Depends(deps.get_session_store),
) -> OperationGraph:
    """Deprecated shim. Calls refine_widget on every active widget with
    the given instruction. Returns the new projected OperationGraph."""
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = "see /api/tools/refine_widget"
    try:
        doc = store.get_document(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    registry = deps.get_tool_registry()
    for wid, w in list(doc.widgets.items()):
        if w.status != "active":
            continue
        await registry.invoke(
            name="refine_widget", session_id=body.session_id,
            raw_input={"widget_id": wid, "edits": [], "additions": [], "instruction": body.instruction},
        )
    return project_to_graph(doc)
```

- [ ] **Step 4: Run the tests**

Run: `pytest backend/tests/test_panel_endpoint.py backend/tests/test_refine.py -v`
Expected: existing tests still pass — the shims preserve the response shape (`OperationGraph`).

Note: the existing tests assume Claude is mocked via `_FakeClaude` in the AnthropicClient fixture. If a test fails because the shim path triggers a different mock requirement (e.g. propose_widget needs `name_pick_fused_tool`), extend the fixture to return canned data for those calls too. Match the test expectation by adjusting the fake, not by reverting the shim.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/panel.py backend/app/api/refine.py
git commit -m "$(cat <<'EOF'
refactor(api): collapse /panel and /refine to shims over tool registry

Both endpoints now delegate to propose_widget / refine_widget on the
registry. Response shape preserved (OperationGraph) and a Deprecation
header is added so legacy clients can migrate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: End-to-end MCP wire test

**Files:**
- Create: `backend/tests/mcp/test_e2e_loop.py`

This test exercises the whole loop over real MCP framing.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/mcp/test_e2e_loop.py
import asyncio
import base64
import io
import json

import pytest
from PIL import Image
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext, Problem


class _FakeClaude:
    def analyze_image(self, image_bytes, mime_type, session_id=None):
        from app.schemas.image_context import ImageContext
        return ImageContext(
            subjects=["scene"], lighting="flat", dominant_tones=["midtones"],
            mood="calm", candidate_regions=[],
            model_name="fake", model_version="0", generated_at="2026-05-21T00:00:00Z",
        )

    def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
        from app.services.anthropic_client import _ContextSoftFields
        return _ContextSoftFields(
            estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.7,
            grade_character="neutral", problems=[], region_soft_fields=[],
        )

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": {
            "temperature": 600, "highlight_warmth": 8, "saturation_lift": 3,
        }, "reasoning": ""}

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"

    def flesh_out_binding(self, request, widget, response_schema=None, session_id=None):
        return {"binding": {
            "param_key": "skin_protect", "label": "Skin protect",
            "control_type": "toggle",
            "target": {"node_id": "n_extra", "param_key": "skin_protect"},
            "schema": {"control_type": "toggle", "on_label": "Protect", "off_label": "Off"},
            "value": True, "default": True,
        }, "additional_nodes": []}


async def _mcp(ac, sid: str, method: str, params: dict, req_id: int) -> dict:
    return (await ac.post(
        "/mcp",
        headers={"x-editor-session-id": sid, "content-type": "application/json"},
        json={"jsonrpc": "2.0", "id": req_id, "method": method, "params": params},
    )).json()


@pytest.mark.asyncio
async def test_full_mcp_loop_create_propose_refine_repeat_delete() -> None:
    from app.main import app

    deps._anthropic_client = _FakeClaude()  # type: ignore[assignment]

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Bootstrap a session with a real JPEG.
        buf = io.BytesIO(); Image.new("RGB", (64, 64), (50, 80, 120)).save(buf, format="JPEG")
        files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]

        # 2. MCP initialize.
        init = await _mcp(ac, sid, "initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "test", "version": "1"},
        }, 1)
        assert init["result"]["serverInfo"]["name"] == "editor-mcp"

        # 3. tools/list contains the headline tools.
        listing = (await _mcp(ac, sid, "tools/list", {}, 2))["result"]["tools"]
        names = {t["name"] for t in listing}
        assert {"propose_widget", "refine_widget", "repeat_widget", "delete_widget"}.issubset(names)

        # 4. analyze_image via MCP.
        env = (await _mcp(ac, sid, "tools/call", {
            "name": "analyze_image", "arguments": {},
        }, 3))["result"]
        outer = json.loads(env["content"][0]["text"])
        assert outer["ok"] is True

        # 5. propose_widget via MCP.
        envp = (await _mcp(ac, sid, "tools/call", {
            "name": "propose_widget",
            "arguments": {"intent": "warmer", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade"},
        }, 4))["result"]
        prop = json.loads(envp["content"][0]["text"])
        assert prop["ok"] is True
        wid = prop["output"]["widget"]["id"]

        # 6. refine_widget — add a skin-protect toggle.
        envr = (await _mcp(ac, sid, "tools/call", {
            "name": "refine_widget",
            "arguments": {"widget_id": wid, "edits": [], "additions": [{"request": "add a skin-protect toggle"}]},
        }, 5))["result"]
        refined = json.loads(envr["content"][0]["text"])
        assert refined["ok"] is True
        keys = [b["param_key"] for b in refined["output"]["widget"]["bindings"]]
        assert "skin_protect" in keys

        # 7. delete_widget.
        envd = (await _mcp(ac, sid, "tools/call", {
            "name": "delete_widget",
            "arguments": {"widget_id": wid, "suppress_similar": True},
        }, 6))["result"]
        deleted = json.loads(envd["content"][0]["text"])
        assert deleted["ok"] is True

        doc = deps.get_session_store().get_document(sid)
        assert doc.widgets[wid].status == "dismissed"
        assert len(doc.dismissals) == 1
```

- [ ] **Step 2: Run the test**

Run: `pytest backend/tests/mcp/test_e2e_loop.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/mcp/test_e2e_loop.py
git commit -m "$(cat <<'EOF'
test(mcp): end-to-end loop — create / analyze / propose / refine / delete

Walks the full MCP wire from initialize through dismiss, exercising
tools/list and tools/call against the real /mcp endpoint with a fake
AnthropicClient.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final regression sweep + tag

- [ ] **Run the full suite**

```bash
pytest backend/tests/ -v
```

Expected: all tests pass, including the legacy `test_panel_endpoint.py` / `test_refine.py` after the shim swap.

- [ ] **Smoke-test the wire from a real shell**

In one terminal:

```bash
cd backend && uvicorn app.main:app --reload --port 8000
```

In another:

```bash
SID=$(curl -s -X POST http://localhost:8000/api/session \
  -F image=@/path/to/a/photo.jpg | jq -r .session_id)

# initialize
curl -s http://localhost:8000/mcp \
  -H "x-editor-session-id: $SID" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"shell","version":"1"}}}' | jq

# tools/list
curl -s http://localhost:8000/mcp \
  -H "x-editor-session-id: $SID" -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq '.result.tools | length'
```

Expected: 1) initialize returns `serverInfo`, 2) `tools/list` returns ~22 tools (Plan 1 + Plan 2 minus REST-only).

- [ ] **Tag the plan close**

```bash
git tag plan3-mcp-stream-complete
```

---

## Plan 3 — what's done

- `/mcp` streamable-HTTP server with `initialize` / `tools/list` / `tools/call`.
- Per-MCP-session token-bucket rate limiter.
- MCP session ↔ editor session pairing via header.
- `GET /api/state/{sid}` snapshot + `GET /api/state/{sid}/events` SSE stream.
- CPU preview renderer + `preview_widget` tool.
- `/api/panel` and `/api/refine` collapsed to thin shims around `propose_widget` / `refine_widget`.
- End-to-end MCP wire test.

## Out of scope for these three plans (future work)

- Frontend implementation of `BackendStateSlice`, the SSE subscriber, and the new control-type renderers. Tracked separately.
- Full WebGL parity for `preview_widget`. CPU approximation is what we ship.
- Focus map + sharpness score (deferred to v3 of EnrichedImageContext).
- Multi-user collaboration / CRDT.
- Brush primitives over MCP. Bitmap brushwork stays a human pointing-device action via REST.
