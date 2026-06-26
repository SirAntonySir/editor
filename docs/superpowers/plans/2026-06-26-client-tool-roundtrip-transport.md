# Client-Tool Round-Trip Transport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend→client→backend tool-call round-trip primitive: the backend can emit a `client.tool_request` SSE event, the frontend executes the requested `LlmToolRegistry` tool (auto for `query`, user-approved for `mutate`), and POSTs the result back, which resolves a correlation Future the backend was awaiting.

**Architecture:** Plan 1 of 3 for the agentic client-tool loop (spec: `docs/superpowers/specs/2026-06-26-agentic-client-tool-loop-design.md`). This plan builds ONLY the transport — no Anthropic agent loop yet (Plan 2). The control event is published directly via `EventBus.publish` (NOT through `doc._emit`) so it is never appended to `doc.history` and therefore never replays on SSE reconnect. Correlation is a per-session `dict[request_id → asyncio.Future]` on `SessionStore`; the loop `await`s the Future with a timeout; the `tool_result` POST resolves it.

**Tech Stack:** FastAPI + Pydantic + asyncio (backend), React + Zustand/Immer + Zod (frontend), pytest + vitest.

## Global Constraints

- TypeScript strict mode; named Lucide imports only; 8-pt spacing; design tokens only (no hardcoded hex/px) — per `CLAUDE.md`.
- Backend `StateEventKind` and frontend `StateEventKind` MUST stay in sync (they mirror).
- The whole gate must pass before each commit: `npm run check` (gen-types + tsc + eslint + vitest) and backend `pytest`.
- Control events (`client.tool_request`) must NOT enter `doc.history` (no `doc._emit`) — publish via `EventBus.publish` only.
- Default per-tool timeout: `60.0` seconds. Timeout is treated as a denial (`{ok: false, denied: true, error: "timeout"}`), never a crash.

---

## File Structure

- `backend/app/schemas/widget.py` — add `"client.tool_request"` to `StateEventKind`.
- `backend/app/services/session_store.py` — add the pending-client-call registry (request/resolve/cancel).
- `backend/app/tools/client_tool_bridge.py` *(new)* — `request_client_tool()` coroutine: emit event + await Future.
- `backend/app/api/state.py` — add `POST /state/{sid}/tool_result`.
- `src/types/widget.ts` — add `'client.tool_request'` to `StateEventKind`.
- `src/lib/backend-tools.ts` — add `postToolResult()`.
- `src/store/client-tool-approval-slice.ts` *(new)* — Zustand slice holding pending `mutate` approvals.
- `src/store/backend-state-slice.ts` — handle the `client.tool_request` SSE event (auto-run query, enqueue mutate).
- `src/components/ui/ClientToolApproval.tsx` *(new)* — allow/deny chips for pending mutate tools (dock slot, mirrors `SuggestionChips`).
- Tests alongside each.

---

### Task 1: Register the `client.tool_request` event kind

**Files:**
- Modify: `backend/app/schemas/widget.py` (`StateEventKind` literal, ends line ~470)
- Modify: `backend/tests/schemas/test_widget.py` (`test_state_event_kinds`)
- Modify: `src/types/widget.ts` (`StateEventKind` union, ~line 273)

**Interfaces:**
- Produces: the string literal `"client.tool_request"` as a valid `StateEventKind` on both sides.

- [ ] **Step 1: Add the kind to the backend test's expected set (failing test)**

In `backend/tests/schemas/test_widget.py`, inside `test_state_event_kinds`, add to the `expected` set (after `"session.ai_access",`):

```python
        "session.ai_access",
        # Plan 1 — backend asks the client to run an LlmToolRegistry tool.
        "client.tool_request",
    }
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/schemas/test_widget.py::test_state_event_kinds -q`
Expected: FAIL — `Extra items in the right set: 'client.tool_request'`.

- [ ] **Step 3: Add the kind to the backend literal**

In `backend/app/schemas/widget.py`, append to the `StateEventKind = Literal[...]` block (after `"session.ai_access",`):

```python
    "session.ai_access",
    # Plan 1 — backend asks the client to run an LlmToolRegistry tool by name.
    # Payload: {request_id, name, input, kind}. Transient control event —
    # published via EventBus.publish only, NEVER appended to doc.history.
    "client.tool_request",
]
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/schemas/test_widget.py::test_state_event_kinds -q`
Expected: PASS.

- [ ] **Step 5: Add the kind to the frontend union**

In `src/types/widget.ts`, extend the `StateEventKind` union (after `| 'session.ai_access'`):

```ts
  | 'session.ai_access'
  | 'client.tool_request';
```

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc -b`
Expected: exit 0.

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_widget.py src/types/widget.ts
git commit -m "feat(transport): register client.tool_request event kind"
```

---

### Task 2: Per-session pending-client-call registry

**Files:**
- Modify: `backend/app/services/session_store.py` (add fields + 3 methods to `SessionStore`)
- Create: `backend/tests/services/test_client_tool_registry.py`

**Interfaces:**
- Produces on `SessionStore`:
  - `new_client_request(self, sid: str) -> tuple[str, asyncio.Future]` — mints a `request_id` (uuid hex), stores a fresh `asyncio.Future`, returns both.
  - `resolve_client_request(self, sid: str, request_id: str, result: dict) -> bool` — sets the Future result; returns `True` if a pending Future existed, else `False`.
  - `cancel_client_requests(self, sid: str) -> int` — resolves every pending Future for `sid` with `{"ok": False, "denied": True, "error": "cancelled"}`; returns the count.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/services/test_client_tool_registry.py`:

```python
import asyncio

import pytest

from app.services.session_store import SessionStore


def test_new_request_returns_id_and_pending_future():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    assert isinstance(request_id, str) and request_id
    assert isinstance(fut, asyncio.Future)
    assert not fut.done()


@pytest.mark.asyncio
async def test_resolve_sets_future_result():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    ok = store.resolve_client_request("sid-1", request_id, {"ok": True, "output": 42})
    assert ok is True
    assert await fut == {"ok": True, "output": 42}


def test_resolve_unknown_request_returns_false():
    store = SessionStore(ttl_seconds=3600)
    assert store.resolve_client_request("sid-1", "nope", {"ok": True}) is False


@pytest.mark.asyncio
async def test_cancel_resolves_pending_as_denied():
    store = SessionStore(ttl_seconds=3600)
    _, fut = store.new_client_request("sid-1")
    n = store.cancel_client_requests("sid-1")
    assert n == 1
    assert await fut == {"ok": False, "denied": True, "error": "cancelled"}


@pytest.mark.asyncio
async def test_resolve_is_one_shot():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    assert store.resolve_client_request("sid-1", request_id, {"ok": True}) is True
    # Second resolve of the same id no longer finds a pending future.
    assert store.resolve_client_request("sid-1", request_id, {"ok": True}) is False
    await fut
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_client_tool_registry.py -q`
Expected: FAIL — `AttributeError: 'SessionStore' object has no attribute 'new_client_request'`.

- [ ] **Step 3: Implement the registry on SessionStore**

In `backend/app/services/session_store.py`, inside `SessionStore.__init__` (after `self._active_tasks: dict[str, asyncio.Task] = {}`), add:

```python
        # Pending backend→client tool-call Futures, keyed sid → request_id →
        # Future. The agent loop awaits the Future; POST /tool_result resolves
        # it. Guarded by self._lock (never held across an await).
        self._pending_client_calls: dict[str, dict[str, asyncio.Future]] = {}
```

Then add these methods to `SessionStore` (place them after `cancel_task`):

```python
    def new_client_request(self, sid: str) -> tuple[str, "asyncio.Future"]:
        """Register a pending backend→client tool call. Returns (request_id,
        future). The agent loop awaits `future`; the POST /tool_result endpoint
        (or cancel) resolves it."""
        request_id = uuid.uuid4().hex
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        with self._lock:
            self._pending_client_calls.setdefault(sid, {})[request_id] = fut
        return request_id, fut

    def resolve_client_request(self, sid: str, request_id: str, result: dict) -> bool:
        """Resolve a pending client tool call with `result`. Returns True if a
        pending (not-yet-done) Future was found and set, False otherwise.
        One-shot: the entry is removed so a duplicate POST is a no-op."""
        with self._lock:
            bucket = self._pending_client_calls.get(sid)
            fut = bucket.pop(request_id, None) if bucket else None
        if fut is None or fut.done():
            return False
        fut.set_result(result)
        return True

    def cancel_client_requests(self, sid: str) -> int:
        """Resolve every pending client tool call for `sid` as a denial. Called
        when a session is cancelled / disconnected so the agent loop unblocks.
        Returns the number cancelled."""
        with self._lock:
            bucket = self._pending_client_calls.pop(sid, {})
        count = 0
        for fut in bucket.values():
            if not fut.done():
                fut.set_result({"ok": False, "denied": True, "error": "cancelled"})
                count += 1
        return count
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_client_tool_registry.py -q`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/session_store.py backend/tests/services/test_client_tool_registry.py
git commit -m "feat(transport): per-session pending client-tool-call registry"
```

---

### Task 3: `request_client_tool` coroutine (emit + await)

**Files:**
- Create: `backend/app/tools/client_tool_bridge.py`
- Create: `backend/tests/tools/test_client_tool_bridge.py`

**Interfaces:**
- Consumes: `SessionStore.new_client_request` (Task 2); `EventBus.publish` (existing, `backend/app/state/events.py`).
- Produces: `async def request_client_tool(store, bus, sid, name, input, kind, timeout=60.0) -> dict` — publishes a `client.tool_request` control `StateEvent` (revision = current `doc.revision`, NOT appended to history), awaits the Future, returns the client's result dict. On timeout returns `{"ok": False, "denied": True, "error": "timeout"}` and drops the pending entry.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/test_client_tool_bridge.py`:

```python
import asyncio

import pytest

from app.services.session_store import SessionStore
from app.state.events import EventBus
from app.tools.client_tool_bridge import request_client_tool


@pytest.mark.asyncio
async def test_request_emits_event_and_returns_resolved_result():
    store = SessionStore(ttl_seconds=3600)
    # Seed a document so doc.revision is readable.
    store.create(image_bytes=b"x", mime_type="image/jpeg")
    sid = next(iter(store._records.keys()))
    bus = EventBus()
    queue = bus.subscribe(sid)

    async def fake_client():
        ev = await queue.get()
        assert ev.kind == "client.tool_request"
        request_id = ev.payload["request_id"]
        assert ev.payload["name"] == "list_objects"
        assert ev.payload["kind"] == "query"
        store.resolve_client_request(sid, request_id, {"ok": True, "output": ["a"]})

    client = asyncio.create_task(fake_client())
    result = await request_client_tool(
        store, bus, sid, name="list_objects", input={}, kind="query", timeout=2.0
    )
    await client
    assert result == {"ok": True, "output": ["a"]}


@pytest.mark.asyncio
async def test_request_times_out_as_denied():
    store = SessionStore(ttl_seconds=3600)
    store.create(image_bytes=b"x", mime_type="image/jpeg")
    sid = next(iter(store._records.keys()))
    bus = EventBus()
    bus.subscribe(sid)  # subscriber exists but never resolves
    result = await request_client_tool(
        store, bus, sid, name="extract_object_to_image_node", input={"maskId": "m1"},
        kind="mutate", timeout=0.05,
    )
    assert result == {"ok": False, "denied": True, "error": "timeout"}
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_client_tool_bridge.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.client_tool_bridge'`.

- [ ] **Step 3: Implement the bridge**

Create `backend/app/tools/client_tool_bridge.py`:

```python
"""Backend→client tool-call bridge.

Lets a backend coroutine (the agent loop, Plan 2) ask the frontend to run an
LlmToolRegistry tool and await its result. The request rides a transient
`client.tool_request` StateEvent published straight to the EventBus — it is
NOT appended to doc.history, so it never replays on SSE reconnect (a replayed
request would re-trigger the tool). The reply arrives via POST /tool_result,
which resolves the correlation Future registered on the SessionStore.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.schemas.widget import StateEvent
from app.services.session_store import SessionStore
from app.state.events import EventBus


async def request_client_tool(
    store: SessionStore,
    bus: EventBus,
    sid: str,
    *,
    name: str,
    input: dict[str, Any],
    kind: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Emit a client.tool_request and await the client's result.

    Returns the client's result dict (shape {ok, output?|error?|denied?}).
    On timeout returns a denial and drops the pending entry so a late reply
    is ignored. Never raises for tool-level failures — those are encoded in
    the returned dict.
    """
    request_id, fut = store.new_client_request(sid)
    # Current revision only — the control event does not mutate state, and we
    # deliberately do NOT call doc._emit (which would append to history).
    doc = store.get_document(sid)
    ev = StateEvent(
        revision=doc.revision,
        kind="client.tool_request",
        payload={"request_id": request_id, "name": name, "input": input, "kind": kind},
    )
    bus.publish(sid, ev)
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        # Drop the now-orphaned Future so a late POST is a no-op.
        store.resolve_client_request(sid, request_id, {"ok": False})
        return {"ok": False, "denied": True, "error": "timeout"}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_client_tool_bridge.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/client_tool_bridge.py backend/tests/tools/test_client_tool_bridge.py
git commit -m "feat(transport): request_client_tool emit-and-await bridge"
```

---

### Task 4: `POST /state/{sid}/tool_result` endpoint

**Files:**
- Modify: `backend/app/api/state.py` (add a request model + route)
- Create: `backend/tests/api/test_tool_result.py`

**Interfaces:**
- Consumes: `SessionStore.resolve_client_request` (Task 2); `deps.get_session_store` (existing).
- Produces: `POST /api/state/{sid}/tool_result` accepting `{request_id, ok, output?, error?, denied?}`; returns `{"resolved": bool}`. 404 if the session is unknown.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_tool_result.py`:

```python
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps


def test_tool_result_resolves_pending_request():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    request_id, fut = store.new_client_request(sid)

    resp = client.post(
        f"/api/state/{sid}/tool_result",
        json={"request_id": request_id, "ok": True, "output": {"image_node_id": "in-3"}},
    )
    assert resp.status_code == 200
    assert resp.json() == {"resolved": True}
    assert fut.done()
    assert fut.result() == {"ok": True, "output": {"image_node_id": "in-3"}, "error": None, "denied": False}


def test_tool_result_unknown_request_returns_resolved_false():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    resp = client.post(
        f"/api/state/{sid}/tool_result",
        json={"request_id": "nope", "ok": True},
    )
    assert resp.status_code == 200
    assert resp.json() == {"resolved": False}
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_tool_result.py -q`
Expected: FAIL — 404 (route not found).

- [ ] **Step 3: Implement the endpoint**

In `backend/app/api/state.py`, add the import near the top (with the other pydantic/typing imports):

```python
from pydantic import BaseModel
```

Add the request model just below the `_store()` / `_bus()` helpers:

```python
class _ToolResultBody(BaseModel):
    request_id: str
    ok: bool
    output: dict | None = None
    error: str | None = None
    denied: bool = False
```

Add the route (place it after `state_snapshot`):

```python
@router.post("/state/{sid}/tool_result")
async def state_tool_result(sid: str, body: _ToolResultBody) -> dict:
    """Resolve a pending backend→client tool call. The frontend POSTs here
    after running (or denying) an LlmToolRegistry tool requested via a
    client.tool_request event. Returns {resolved: bool} — False when the
    request_id is unknown (already resolved, timed out, or never existed)."""
    store = _store()
    try:
        store.touch(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    resolved = store.resolve_client_request(
        sid,
        body.request_id,
        {"ok": body.ok, "output": body.output, "error": body.error, "denied": body.denied},
    )
    return {"resolved": resolved}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_tool_result.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/state.py backend/tests/api/test_tool_result.py
git commit -m "feat(transport): POST /state/{sid}/tool_result endpoint"
```

---

### Task 5: Cancel rejects pending client requests

**Files:**
- Modify: `backend/app/services/session_store.py` (`cancel_task` also rejects pending client calls)
- Modify: `backend/tests/services/test_client_tool_registry.py` (add a test)

**Interfaces:**
- Consumes: `cancel_client_requests` (Task 2).
- Produces: calling `SessionStore.cancel_task(sid)` now also resolves all pending client Futures for `sid` as denied, so an in-flight agent loop unblocks on user cancel.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/services/test_client_tool_registry.py`:

```python
@pytest.mark.asyncio
async def test_cancel_task_also_rejects_pending_client_calls():
    store = SessionStore(ttl_seconds=3600)
    _, fut = store.new_client_request("sid-1")
    # cancel_task with no asyncio.Task registered still must drain client calls.
    store.cancel_task("sid-1")
    assert await fut == {"ok": False, "denied": True, "error": "cancelled"}
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_client_tool_registry.py::test_cancel_task_also_rejects_pending_client_calls -q`
Expected: FAIL — the Future never resolves (test hangs → use `-x --timeout=5` if the suite has pytest-timeout; otherwise the assertion never reached). Confirm failure, then proceed.

- [ ] **Step 3: Wire cancel_task to drain client calls**

In `backend/app/services/session_store.py`, at the END of `cancel_task` (after the existing `task.cancel(); return True` logic), ensure pending client calls are also drained. Replace the method body's tail so the drain runs on every cancel:

```python
    def cancel_task(self, sid: str) -> bool:
        """Cancel the in-flight tool task for this session, if any, AND reject
        every pending backend→client tool call so a blocked agent loop unblocks.
        Returns True when an asyncio.Task was cancelled, False otherwise."""
        self.cancel_client_requests(sid)
        with self._lock:
            task = self._active_tasks.get(sid)
        if task is None or task.done():
            return False
        task.cancel()
        return True
```

(Keep the existing docstring/comment about non-preemptible SDK calls if present — fold it in.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_client_tool_registry.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/session_store.py backend/tests/services/test_client_tool_registry.py
git commit -m "feat(transport): cancel drains pending client tool calls"
```

---

### Task 6: Frontend `postToolResult` helper

**Files:**
- Modify: `src/lib/backend-tools.ts` (add `postToolResult` to the `backendTools` object)
- Create: `src/lib/backend-tools.tool-result.test.ts`

**Interfaces:**
- Produces: `backendTools.postToolResult(sessionId: string, result: { requestId: string; ok: boolean; output?: unknown; error?: string; denied?: boolean }): Promise<{ resolved: boolean }>` — POSTs to `/api/state/${sessionId}/tool_result` with snake_case body.

- [ ] **Step 1: Write the failing test**

Create `src/lib/backend-tools.tool-result.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { backendTools } from './backend-tools';

afterEach(() => vi.unstubAllGlobals());

describe('backendTools.postToolResult', () => {
  it('POSTs the result to /tool_result with snake_case body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resolved: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await backendTools.postToolResult('sid-1', {
      requestId: 'req-1', ok: true, output: { imageNodeId: 'in-3' },
    });

    expect(out).toEqual({ resolved: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/state/sid-1/tool_result');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.request_id).toBe('req-1');
    expect(body.ok).toBe(true);
    expect(body.output).toEqual({ imageNodeId: 'in-3' });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/lib/backend-tools.tool-result.test.ts`
Expected: FAIL — `backendTools.postToolResult is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/lib/backend-tools.ts`, add a method inside the exported `backendTools` object (next to other `/api/state/...` calls):

```ts
  async postToolResult(
    sessionId: string,
    result: { requestId: string; ok: boolean; output?: unknown; error?: string; denied?: boolean },
  ): Promise<{ resolved: boolean }> {
    const response = await fetch(`${BASE_URL}/api/state/${sessionId}/tool_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_id: result.requestId,
        ok: result.ok,
        output: result.output ?? null,
        error: result.error ?? null,
        denied: result.denied ?? false,
      }),
    });
    if (!response.ok) throw new Error(`tool_result POST failed: ${response.status}`);
    return response.json() as Promise<{ resolved: boolean }>;
  },
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/lib/backend-tools.tool-result.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backend-tools.ts src/lib/backend-tools.tool-result.test.ts
git commit -m "feat(transport): frontend postToolResult helper"
```

---

### Task 7: Frontend approval slice (pending mutate tools)

**Files:**
- Create: `src/store/client-tool-approval-slice.ts`
- Create: `src/store/client-tool-approval-slice.test.ts`

**Interfaces:**
- Produces a Zustand store `useClientToolApproval` with:
  - state `pending: PendingClientTool[]` where `PendingClientTool = { requestId: string; name: string; input: Record<string, unknown> }`.
  - `enqueue(req: PendingClientTool): void`
  - `remove(requestId: string): void`
  - `reset(): void`

- [ ] **Step 1: Write the failing test**

Create `src/store/client-tool-approval-slice.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useClientToolApproval } from './client-tool-approval-slice';

beforeEach(() => useClientToolApproval.getState().reset());

describe('client-tool-approval-slice', () => {
  it('enqueues and removes pending mutate requests by id', () => {
    const s = useClientToolApproval.getState();
    s.enqueue({ requestId: 'r1', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    s.enqueue({ requestId: 'r2', name: 'convert_object_to_layer_mask', input: { maskId: 'm2' } });
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r1', 'r2']);

    s.remove('r1');
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r2']);
  });

  it('reset clears everything', () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r1', name: 'x', input: {} });
    useClientToolApproval.getState().reset();
    expect(useClientToolApproval.getState().pending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/store/client-tool-approval-slice.test.ts`
Expected: FAIL — cannot find module `./client-tool-approval-slice`.

- [ ] **Step 3: Implement the slice**

Create `src/store/client-tool-approval-slice.ts`:

```ts
import { create } from 'zustand';

/** A mutate-kind client tool the backend asked us to run, awaiting the user's
 *  allow/deny decision. `query` tools never enter this queue — they auto-run. */
export interface PendingClientTool {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
}

interface ClientToolApprovalState {
  pending: PendingClientTool[];
  enqueue: (req: PendingClientTool) => void;
  remove: (requestId: string) => void;
  reset: () => void;
}

export const useClientToolApproval = create<ClientToolApprovalState>((set) => ({
  pending: [],
  enqueue: (req) =>
    set((s) =>
      s.pending.some((p) => p.requestId === req.requestId)
        ? s
        : { pending: [...s.pending, req] },
    ),
  remove: (requestId) =>
    set((s) => ({ pending: s.pending.filter((p) => p.requestId !== requestId) })),
  reset: () => set({ pending: [] }),
}));
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/store/client-tool-approval-slice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/client-tool-approval-slice.ts src/store/client-tool-approval-slice.test.ts
git commit -m "feat(transport): client-tool approval slice"
```

---

### Task 8: SSE handler — auto-run query, enqueue mutate

**Files:**
- Modify: `src/store/backend-state-slice.ts` (handle `client.tool_request` in the pre-guard switch + a module helper)
- Create: `src/store/backend-state-slice.client-tool.test.ts`

**Interfaces:**
- Consumes: `LlmToolRegistry.invoke` + new `LlmToolRegistry.getKind` (`src/lib/tool-manifest/llm-tool-registry.ts`), `backendTools.postToolResult` (Task 6), `useClientToolApproval.enqueue` (Task 7).
- Produces: `LlmToolRegistry.getKind(name)`; and in `applyEvent`, a `case 'client.tool_request'` that, via a side-effect, runs `runClientTool(req)`. **The CLIENT is authoritative on the tool's kind** — `runClientTool` looks up the kind in its own registry (`getKind`), defaulting to `'mutate'` (safest) if unknown, and ignores any `kind` in the payload. So a malformed/spoofed payload can never auto-run a destructive tool. Exported `runClientTool(req): Promise<void>` for testing.

- [ ] **Step 1: Add `getKind` to LlmToolRegistry**

In `src/lib/tool-manifest/llm-tool-registry.ts`, add a method to `LlmToolRegistryImpl` (next to `invoke`):

```ts
  /** The manifest's declared kind, or undefined if the tool is unknown. The
   *  SSE handler uses this as the AUTHORITATIVE kind (not the event payload)
   *  so approval gating can't be bypassed by a bad request. */
  getKind(name: string): import('./types').ToolKind | undefined {
    return this.manifests.get(name)?.kind;
  }
```

- [ ] **Step 2: Write the failing test**

Create `src/store/backend-state-slice.client-tool.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { postToolResult: vi.fn(async () => ({ resolved: true })) },
}));
vi.mock('@/lib/tool-manifest/llm-tool-registry', () => ({
  LlmToolRegistry: {
    invoke: vi.fn(async () => ['sky']),
    getKind: vi.fn((name: string) => (name === 'list_objects' ? 'query' : 'mutate')),
  },
}));

const { backendTools } = await import('@/lib/backend-tools');
const { LlmToolRegistry } = await import('@/lib/tool-manifest/llm-tool-registry');
const { runClientTool } = await import('./backend-state-slice');
const { useBackendState } = await import('./backend-state-slice');
const { useClientToolApproval } = await import('./client-tool-approval-slice');

beforeEach(() => {
  vi.clearAllMocks();
  useClientToolApproval.getState().reset();
  useBackendState.getState().setSessionId('sid-1');
});

describe('runClientTool', () => {
  it('auto-runs a query tool (kind from registry) and posts the result', async () => {
    await runClientTool({ requestId: 'r1', name: 'list_objects', input: {} });
    expect(LlmToolRegistry.invoke).toHaveBeenCalledWith('list_objects', {});
    expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', {
      requestId: 'r1', ok: true, output: ['sky'],
    });
    expect(useClientToolApproval.getState().pending).toEqual([]);
  });

  it('enqueues a mutate tool for approval and does NOT auto-run', async () => {
    await runClientTool({ requestId: 'r2', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
    expect(backendTools.postToolResult).not.toHaveBeenCalled();
    expect(useClientToolApproval.getState().pending).toEqual([
      { requestId: 'r2', name: 'extract_object_to_image_node', input: { maskId: 'm1' } },
    ]);
  });

  it('treats an unknown tool as mutate (fails safe → approval, no auto-run)', async () => {
    (LlmToolRegistry.getKind as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    await runClientTool({ requestId: 'r3', name: 'mystery_tool', input: {} });
    expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r3']);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/store/backend-state-slice.client-tool.test.ts`
Expected: FAIL — `runClientTool` is not exported.

- [ ] **Step 4: Implement `runClientTool` + the SSE case**

In `src/store/backend-state-slice.ts`, add imports at the top:

```ts
import { LlmToolRegistry } from '@/lib/tool-manifest/llm-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { useClientToolApproval } from '@/store/client-tool-approval-slice';
```

Add this exported helper at module scope (below the store definition):

```ts
/** Execute a backend-requested client tool. The kind is resolved from the LOCAL
 *  registry (authoritative), NOT the event payload, and defaults to 'mutate'
 *  when unknown — so approval gating can never be bypassed. `query`/`emit`
 *  tools run immediately and post their result; `mutate` tools are enqueued for
 *  the user's allow/deny decision (resolved later by ClientToolApproval). */
export async function runClientTool(req: {
  requestId: string;
  name: string;
  input: Record<string, unknown>;
}): Promise<void> {
  const kind = LlmToolRegistry.getKind(req.name) ?? 'mutate';
  if (kind === 'mutate') {
    useClientToolApproval.getState().enqueue({
      requestId: req.requestId, name: req.name, input: req.input,
    });
    return;
  }
  const sid = useBackendState.getState().sessionId;
  if (!sid) return;
  try {
    const output = await LlmToolRegistry.invoke(req.name, req.input);
    await backendTools.postToolResult(sid, { requestId: req.requestId, ok: true, output });
  } catch (err) {
    await backendTools.postToolResult(sid, {
      requestId: req.requestId, ok: false, error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

In `applyEvent`, inside the PRE-guard `switch (ev.kind)` block (the one before `if (!s.snapshot) return`), add a case (next to `'session.ai_access'`):

```ts
          case 'client.tool_request': {
            const p = payload as {
              request_id?: string; name?: string; input?: Record<string, unknown>;
            };
            if (p.request_id && p.name) {
              const req = { requestId: p.request_id, name: p.name, input: p.input ?? {} };
              sideEffects.push(() => { void runClientTool(req); });
            }
            return;
          }
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/store/backend-state-slice.client-tool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/store/backend-state-slice.ts src/lib/tool-manifest/llm-tool-registry.ts src/store/backend-state-slice.client-tool.test.ts
git commit -m "feat(transport): SSE handler runs query tools, queues mutate for approval"
```

---

### Task 9: Approval UI (allow/deny chips for mutate tools)

**Files:**
- Create: `src/components/ui/ClientToolApproval.tsx`
- Modify: `src/components/ui/FloatingDock.tsx` (mount `<ClientToolApproval />` next to `<SuggestionChips />`)
- Create: `src/components/ui/ClientToolApproval.test.tsx`

**Interfaces:**
- Consumes: `useClientToolApproval` (Task 7), `LlmToolRegistry.invoke` + `backendTools.postToolResult` (run on allow), `useBackendState.sessionId`, `useAiAccess` (hide entirely in the study control condition).
- Produces: a dock component rendering one allow/deny chip per pending mutate tool. Allow → invoke + `postToolResult(ok)` + `remove`; Deny → `postToolResult(denied)` + `remove`.

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/ClientToolApproval.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { postToolResult: vi.fn(async () => ({ resolved: true })) },
}));
vi.mock('@/lib/tool-manifest/llm-tool-registry', () => ({
  LlmToolRegistry: { invoke: vi.fn(async () => ({ image_node_id: 'in-3' })) },
}));
vi.mock('@/lib/ai-access', () => ({ useAiAccess: () => true }));

const { backendTools } = await import('@/lib/backend-tools');
const { LlmToolRegistry } = await import('@/lib/tool-manifest/llm-tool-registry');
const { useClientToolApproval } = await import('@/store/client-tool-approval-slice');
const { useBackendState } = await import('@/store/backend-state-slice');
const { ClientToolApproval } = await import('./ClientToolApproval');

beforeEach(() => {
  vi.clearAllMocks();
  useClientToolApproval.getState().reset();
  useBackendState.getState().setSessionId('sid-1');
});

describe('ClientToolApproval', () => {
  it('Allow runs the tool and posts ok, then dequeues', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r1', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).toHaveBeenCalledWith('extract_object_to_image_node', { maskId: 'm1' });
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r1', ok: true, output: { image_node_id: 'in-3' } });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });

  it('Deny posts denied without running the tool', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r2', name: 'convert_object_to_layer_mask', input: { maskId: 'm2' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r2', ok: false, denied: true });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/components/ui/ClientToolApproval.test.tsx`
Expected: FAIL — cannot find module `./ClientToolApproval`.

- [ ] **Step 3: Implement the component**

Create `src/components/ui/ClientToolApproval.tsx`:

```tsx
import { Check, X } from 'lucide-react';
import { useClientToolApproval } from '@/store/client-tool-approval-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { LlmToolRegistry } from '@/lib/tool-manifest/llm-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { useAiAccess } from '@/lib/ai-access';

/** Allow/deny chips for backend-requested mutate tools (the per-step approval
 *  gate). Mirrors SuggestionChips' dock slot. Hidden entirely in the study
 *  control condition (AI_access=false). */
export function ClientToolApproval() {
  const aiAccess = useAiAccess();
  const pending = useClientToolApproval((s) => s.pending);
  if (!aiAccess || pending.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1" role="region" aria-label="AI tool approvals">
      {pending.map((req) => (
        <div
          key={req.requestId}
          className="overlay flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-primary"
        >
          <span className="text-[var(--color-ai)]">{describe(req.name)}</span>
          <button
            type="button"
            aria-label="Allow"
            onClick={() => void resolve(req.requestId, req.name, req.input, true)}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            aria-label="Deny"
            onClick={() => void resolve(req.requestId, req.name, req.input, false)}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:bg-surface-secondary"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Human-readable label for a tool request. Kept terse for the dock chip. */
function describe(name: string): string {
  if (name === 'extract_object_to_image_node') return 'Extract object to a new image node?';
  if (name === 'convert_object_to_layer_mask') return 'Convert object to a layer mask?';
  return `Run ${name}?`;
}

async function resolve(
  requestId: string,
  name: string,
  input: Record<string, unknown>,
  allow: boolean,
): Promise<void> {
  const remove = useClientToolApproval.getState().remove;
  const sid = useBackendState.getState().sessionId;
  if (!sid) { remove(requestId); return; }
  if (!allow) {
    await backendTools.postToolResult(sid, { requestId, ok: false, denied: true });
    remove(requestId);
    return;
  }
  try {
    const output = await LlmToolRegistry.invoke(name, input);
    await backendTools.postToolResult(sid, { requestId, ok: true, output });
  } catch (err) {
    await backendTools.postToolResult(sid, {
      requestId, ok: false, error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    remove(requestId);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/components/ui/ClientToolApproval.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Mount it in the dock**

In `src/components/ui/FloatingDock.tsx`, add the import and render it just above `<SuggestionChips />`:

```tsx
import { ClientToolApproval } from '@/components/ui/ClientToolApproval';
```

```tsx
      <ClientToolApproval />
      <SuggestionChips />
```

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`
Expected: all green (tsc + eslint + vitest).

```bash
git add src/components/ui/ClientToolApproval.tsx src/components/ui/ClientToolApproval.test.tsx src/components/ui/FloatingDock.tsx
git commit -m "feat(transport): allow/deny approval chips for mutate tools"
```

---

## Final verification

- [ ] **Backend suite**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/ -q`
Expected: all pass except the pre-existing `test_prune_disk_removes_old_records` (unrelated, see git history).

- [ ] **Frontend gate**

Run: `npm run check`
Expected: exit 0.

---

## Self-review notes (coverage vs spec §3.A, §3.C)

- §3.A transport: `client.tool_request` event (Task 1), correlation registry (Task 2), `request_client_tool` emit+await (Task 3), `POST tool_result` (Task 4), cancel/disconnect drains Futures (Task 5). ✔
- §3.C gating: query auto-run, mutate → approval (Tasks 8–9). ✔
- §3.G timeout→denied (Task 3), atomic-undo / max-iterations are Plan 2 (agent loop) concerns — out of scope here. Noted.
- **Deferred to Plan 2:** manifest sharing, the Anthropic agent loop, `propose_adjustment_widgets`. **Deferred to Plan 3:** `extract` backend-registration + id flow, chip→structured scope.

## Follow-up plans

- **Plan 2 — Agent loop + manifest sharing + `propose_adjustment_widgets`** (consumes this transport). Write via `superpowers:writing-plans` after Plan 1 ships.
- **Plan 3 — `extract` backend-registration + id-flow + chip→structured scope** (the motivating flow end-to-end).
