# Agent Loop + Manifest Sharing — Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the command-palette agent-mode prompt agentic — a backend multi-turn Anthropic tool-use loop in which the LLM can call the editor's client-side tools (via the Plan-1 round-trip) and a `propose_adjustment_widgets` tool (dispatched to the existing `propose_stack`), targeting the active image node.

**Architecture:** Plan 2 of 3 (spec: `docs/superpowers/specs/2026-06-26-agentic-client-tool-loop-design.md` §3.B/E/F). Builds on Plan 1's transport (`request_client_tool`, `client.tool_request`, `POST /tool_result`). The orchestrator (`run_agent_turn`) holds **NO session write-lock** — that's the §7 deadlock fix: `registry.invoke` holds the lock for a tool's whole duration (`registry.py:153`), so the loop must dispatch sub-mutations *into* `registry.invoke` (brief locks) rather than running inside one. `propose_adjustment_widgets` is **not** a new tool; it constructs an `image_node` scope and calls `registry.invoke("propose_stack", …)`. The loop is dependency-injected so it unit-tests against a mocked Anthropic with fakes.

**Tech Stack:** FastAPI + Anthropic SDK + asyncio (backend), React + Zustand + Zod (frontend), pytest + vitest.

## Global Constraints

- TypeScript strict; named Lucide imports; design tokens only — per `CLAUDE.md`.
- Backend/frontend `StateEventKind` stay in sync (already done in Plan 1).
- Gate must pass before each commit: `npm run check` + backend `pytest`.
- The orchestrator MUST NOT hold the per-session write-lock across awaits (Anthropic calls, client round-trips, sub-tool invokes). Sub-mutations acquire the lock only inside `registry.invoke`.
- Max tool calls per turn: **10** (hard stop). Per-client-tool timeout is Plan 1's `request_client_tool` default (60s).
- Plan 2 targets the **active/original** image node only. The `extract → new node → edit` targeting is Plan 3 (extract is not yet backend-aware). The loop seeds `node_layers` from the request and returns an error tool_result for an unknown `target_image_node_id`.
- v1 tool set (spec §3.F): query `get_image_context`, `list_objects`, `get_active_selection`; selection `select_object`; mutate `extract_object_to_image_node`, `convert_object_to_layer_mask`; plus `propose_adjustment_widgets`.

---

## File Structure

- `src/lib/tool-manifest/serialize.ts` — add `serializeForAgentLoop(allowed)` (filtered v1 set).
- `src/lib/backend-tools.ts` — add `agentTurn()`.
- `src/lib/palette-actions.ts` — add `runAgentTurn()`.
- `src/components/CommandPalette.tsx` — agent-mode AI submit calls `runAgentTurn` (keep `tool_invoked`/toolrail on `propose_stack`).
- `backend/app/services/anthropic_client.py` — add `agent_message()` (one multi-turn step).
- `backend/app/tools/agent_loop.py` *(new)* — `dispatch_propose_adjustment()` + `run_agent_turn()` (the loop).
- `backend/app/api/state.py` — add `POST /state/{sid}/agent_turn`.
- Tests alongside each.

---

### Task 1: Filtered manifest serializer

**Files:**
- Modify: `src/lib/tool-manifest/serialize.ts`
- Create: `src/lib/tool-manifest/serialize.agent-loop.test.ts`

**Interfaces:**
- Consumes: `LlmToolRegistry.getAll`, `serializeManifest` (existing).
- Produces: `serializeForAgentLoop(allowed: string[]): AnthropicToolDescription[]` — serializes only the manifests whose `name` is in `allowed`, preserving `allowed` order; silently skips names not registered.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tool-manifest/serialize.agent-loop.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { LlmToolRegistry } from './llm-tool-registry';
import { serializeForAgentLoop } from './serialize';

beforeEach(() => {
  LlmToolRegistry.clear();
  for (const name of ['list_objects', 'extract_object_to_image_node', 'add_note']) {
    LlmToolRegistry.register({
      name,
      description: `desc ${name}`,
      kind: name === 'list_objects' ? 'query' : 'mutate',
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: () => ({}),
    });
  }
});

describe('serializeForAgentLoop', () => {
  it('includes only allowed tools, in allowed order', () => {
    const out = serializeForAgentLoop(['extract_object_to_image_node', 'list_objects']);
    expect(out.map((t) => t.name)).toEqual(['extract_object_to_image_node', 'list_objects']);
    // 'add_note' registered but not allowed → excluded.
  });

  it('skips allowed names that are not registered', () => {
    const out = serializeForAgentLoop(['list_objects', 'nope']);
    expect(out.map((t) => t.name)).toEqual(['list_objects']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/tool-manifest/serialize.agent-loop.test.ts`
Expected: FAIL — `serializeForAgentLoop` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/tool-manifest/serialize.ts`, append:

```ts
/**
 * Serialise only the named tools, in the given order — the curated set the
 * agent loop exposes to the LLM (spec §3.F). Names not currently registered
 * are skipped (so a deferred tool simply doesn't appear).
 */
export function serializeForAgentLoop(allowed: string[]): AnthropicToolDescription[] {
  const out: AnthropicToolDescription[] = [];
  for (const name of allowed) {
    const manifest = LlmToolRegistry.get(name);
    if (manifest) out.push(serializeManifest(manifest));
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/tool-manifest/serialize.agent-loop.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tool-manifest/serialize.ts src/lib/tool-manifest/serialize.agent-loop.test.ts
git commit -m "feat(agent): filtered manifest serializer for the agent loop"
```

---

### Task 2: Frontend `agentTurn` request + `runAgentTurn`

**Files:**
- Modify: `src/lib/backend-tools.ts` (add `agentTurn`)
- Create: `src/lib/palette-actions.agent.ts` (the `runAgentTurn` helper + the v1 tool-name list)
- Create: `src/lib/palette-actions.agent.test.ts`

**Interfaces:**
- Consumes: `serializeForAgentLoop` (Task 1).
- Produces:
  - `backendTools.agentTurn(sessionId, body): Promise<{ ok: boolean; toolCalls: number }>` — POST `/api/state/${sessionId}/agent_turn` with `{ intent, attached_objects, client_tools }`.
  - `AGENT_LOOP_TOOLS: string[]` — the v1 curated tool names.
  - `runAgentTurn(prompt: string, attachedObjects: string[]): Promise<{ ok: boolean; toolCalls: number }>` — serializes `AGENT_LOOP_TOOLS`, reads `useBackendState.sessionId`, calls `agentTurn`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/palette-actions.agent.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tool-manifest/serialize', () => ({
  serializeForAgentLoop: vi.fn((names: string[]) => names.map((n) => ({ name: n, description: '', input_schema: {} }))),
}));

const { useBackendState } = await import('@/store/backend-state-slice');
const { runAgentTurn, AGENT_LOOP_TOOLS } = await import('./palette-actions.agent');

beforeEach(() => {
  useBackendState.getState().setSessionId('sid-1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, tool_calls: 2 }), { status: 200 })));
});

describe('runAgentTurn', () => {
  it('POSTs intent + attached_objects + serialized client_tools', async () => {
    const out = await runAgentTurn('make the sky dramatic', ['mask_sky']);
    expect(out).toEqual({ ok: true, toolCalls: 2 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/state/sid-1/agent_turn');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.intent).toBe('make the sky dramatic');
    expect(body.attached_objects).toEqual(['mask_sky']);
    expect(body.client_tools.map((t: { name: string }) => t.name)).toEqual(AGENT_LOOP_TOOLS);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: FAIL — cannot find module `./palette-actions.agent`.

- [ ] **Step 3: Add `agentTurn` to backend-tools**

In `src/lib/backend-tools.ts`, add a method to the `backendTools` object (next to `postToolResult`):

```ts
  /** Start an agentic turn: the backend runs a multi-turn Anthropic loop that
   *  may call client tools (via client.tool_request) and propose_adjustment_widgets. */
  async agentTurn(
    sessionId: string,
    body: { intent: string; attached_objects: string[]; client_tools: unknown[] },
  ): Promise<{ ok: boolean; toolCalls: number }> {
    const response = await fetch(`${BASE_URL}/api/state/${sessionId}/agent_turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`agent_turn failed: ${response.status}`);
    const json = (await response.json()) as { ok: boolean; tool_calls: number };
    return { ok: json.ok, toolCalls: json.tool_calls };
  },
```

- [ ] **Step 4: Implement `runAgentTurn`**

Create `src/lib/palette-actions.agent.ts`:

```ts
import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';

/** The v1 curated tool set the agent loop exposes to the LLM (spec §3.F).
 *  propose_adjustment_widgets is dispatched server-side, so it is NOT a client
 *  manifest — it's added to the Anthropic tools list by the backend. */
export const AGENT_LOOP_TOOLS: string[] = [
  'get_image_context',
  'list_objects',
  'get_active_selection',
  'select_object',
  'extract_object_to_image_node',
  'convert_object_to_layer_mask',
];

/** Run an agentic palette turn. Serializes the curated client tools, attaches
 *  any object ids the user pinned as chips, and POSTs to the backend loop. */
export async function runAgentTurn(
  prompt: string,
  attachedObjects: string[],
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };
  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: attachedObjects,
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
  });
}
```

- [ ] **Step 5: Run, verify pass + commit**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: PASS.

```bash
git add src/lib/backend-tools.ts src/lib/palette-actions.agent.ts src/lib/palette-actions.agent.test.ts
git commit -m "feat(agent): frontend agentTurn request + runAgentTurn"
```

---

### Task 3: Backend `dispatch_propose_adjustment`

**Files:**
- Create: `backend/app/tools/agent_loop.py` (this function only; the loop is Task 4)
- Create: `backend/tests/tools/test_agent_loop_dispatch.py`

**Interfaces:**
- Consumes: `BackendToolRegistry.invoke(name, session_id, raw_input) -> ToolResponseEnvelope` (existing; acquires the write-lock per call).
- Produces: `async def dispatch_propose_adjustment(registry, sid, *, target_image_node_id, layer_ids, intent) -> dict` — builds an `image_node` scope and invokes `propose_stack`. Returns a compact result for the LLM: `{"ok": bool, "widget_count": int}` on success, `{"ok": False, "error": str}` on failure.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/test_agent_loop_dispatch.py`:

```python
import pytest

from app.tools.agent_loop import dispatch_propose_adjustment


class _FakeEnvelope:
    def __init__(self, ok, data=None, error=None):
        self.ok = ok
        self.data = data
        self.error = error


class _FakeRegistry:
    def __init__(self, envelope):
        self._envelope = envelope
        self.calls = []

    async def invoke(self, name, session_id, raw_input):
        self.calls.append((name, session_id, raw_input))
        return self._envelope


@pytest.mark.asyncio
async def test_dispatch_builds_image_node_scope_and_invokes_propose_stack():
    reg = _FakeRegistry(_FakeEnvelope(ok=True, data={"widgets": [{"id": "w1"}, {"id": "w2"}]}))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="dramatic sky",
    )
    assert result == {"ok": True, "widget_count": 2}
    name, sid, raw = reg.calls[0]
    assert name == "propose_stack"
    assert sid == "sid-1"
    assert raw["intent"] == "dramatic sky"
    assert raw["origin"] == "mcp_user_prompt"
    assert raw["scope"] == {"kind": "image_node", "image_node_id": "in-1", "layer_ids": ["l-1"]}


@pytest.mark.asyncio
async def test_dispatch_returns_error_on_tool_failure():
    reg = _FakeRegistry(_FakeEnvelope(ok=False, error={"message": "boom"}))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="x",
    )
    assert result["ok"] is False
    assert "boom" in result["error"]
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_dispatch.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.tools.agent_loop'`.

- [ ] **Step 3: Implement**

Create `backend/app/tools/agent_loop.py`:

```python
"""Agentic palette turn: a multi-turn Anthropic tool-use loop.

The orchestrator (run_agent_turn, Task 4) holds NO session write-lock — it
dispatches sub-mutations INTO registry.invoke (which acquires the lock per
call) and client tools into request_client_tool (no lock). This avoids the
deadlock that would occur if the loop ran inside one long-held lock.

propose_adjustment_widgets is not a separate tool: it builds an image_node
scope and reuses the existing propose_stack tool wholesale.
"""

from __future__ import annotations

from typing import Any


async def dispatch_propose_adjustment(
    registry: Any,
    sid: str,
    *,
    target_image_node_id: str,
    layer_ids: list[str],
    intent: str,
) -> dict[str, Any]:
    """Propose adjustment widgets on a specific image node by invoking the
    existing propose_stack tool with an image_node scope. Returns a compact
    result for the LLM (full widget JSON streams to the client via SSE)."""
    scope = {"kind": "image_node", "image_node_id": target_image_node_id, "layer_ids": layer_ids}
    envelope = await registry.invoke(
        "propose_stack",
        sid,
        {"intent": intent, "scope": scope, "origin": "mcp_user_prompt", "prompt": intent},
    )
    if not envelope.ok:
        message = ""
        if isinstance(envelope.error, dict):
            message = envelope.error.get("message", "")
        return {"ok": False, "error": message or "propose_stack failed"}
    widgets = (envelope.data or {}).get("widgets", []) if isinstance(envelope.data, dict) else []
    return {"ok": True, "widget_count": len(widgets)}
```

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_dispatch.py -q`
Expected: PASS (2 tests).

```bash
git add backend/app/tools/agent_loop.py backend/tests/tools/test_agent_loop_dispatch.py
git commit -m "feat(agent): propose_adjustment_widgets dispatch to propose_stack"
```

---

### Task 4: The multi-turn loop `run_agent_turn`

> **CARE POINT (execution):** This is the highest-uncertainty task. The Anthropic
> SDK's tool-use blocks are accessed below via `getattr(block, "type", ...)` /
> `block.name` / `block.input` / `block.id` and `response.stop_reason`, matching
> the existing `anthropic_client.py` access pattern (e.g. line 571). Verify
> these against the installed SDK version when running; adjust block/field
> access if the SDK shape differs. The loop logic + dispatch are SDK-agnostic
> and fully covered by the fake below.

**Files:**
- Modify: `backend/app/services/anthropic_client.py` (add `agent_message`)
- Modify: `backend/app/tools/agent_loop.py` (add `run_agent_turn` + a system-prompt builder)
- Create: `backend/tests/tools/test_agent_loop_run.py`

**Interfaces:**
- Consumes: `dispatch_propose_adjustment` (Task 3); `request_client_tool` (Plan 1) wrapped as `client_tool_fn`; an `agent_step(system, messages, tools) -> response` callable.
- Produces: `async def run_agent_turn(*, agent_step, sid, intent, attached_objects, client_tools, node_layers, propose_fn, client_tool_fn, max_tool_calls=10) -> dict` returning `{"ok": True, "tool_calls": int}`. Loop: call `agent_step`; for each `tool_use` block — `propose_adjustment_widgets` → `propose_fn(target_image_node_id, intent)` (looks up `node_layers`; unknown node → error result); any other name → `client_tool_fn(name, input)`; feed `tool_result` back; stop on `end_turn` or `max_tool_calls`.
  - `propose_fn(target_image_node_id, intent) -> dict` and `client_tool_fn(name, input) -> dict` are injected (the endpoint, Task 5, wires the real ones).
  - `agent_step(system, messages, tools) -> response` where `response.stop_reason: str` and `response.content: list[block]` with `tool_use` blocks exposing `.type`, `.name`, `.input`, `.id`.

- [ ] **Step 1: Write the failing test (loop logic with a scripted fake LLM)**

Create `backend/tests/tools/test_agent_loop_run.py`:

```python
import pytest

from app.tools.agent_loop import run_agent_turn


class _Block:
    def __init__(self, type, name=None, input=None, id=None):
        self.type = type
        self.name = name
        self.input = input
        self.id = id


class _Resp:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


class _ScriptedLLM:
    """Returns a queued response per call; records the messages it received."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, system, messages, tools):
        self.calls.append({"system": system, "messages": list(messages), "tools": tools})
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_loop_dispatches_propose_then_ends():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-1", "intent": "dramatic"}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(target_image_node_id, intent):
        proposed.append((target_image_node_id, intent))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="make it dramatic", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 1}
    assert proposed == [("in-1", "dramatic")]
    # Second LLM call must have received a tool_result for tu_1.
    second_msgs = llm.calls[1]["messages"]
    assert any(
        m["role"] == "user" and isinstance(m["content"], list)
        and any(c.get("type") == "tool_result" and c.get("tool_use_id") == "tu_1" for c in m["content"])
        for m in second_msgs
    )


@pytest.mark.asyncio
async def test_loop_routes_client_tool_and_unknown_node_errors():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "list_objects", {}, "tu_1")]),
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-UNKNOWN", "intent": "x"}, "tu_2")]),
        _Resp("end_turn", [_Block("text")]),
    ])

    async def propose_fn(target_image_node_id, intent):
        raise AssertionError("unknown node must not reach propose_fn")

    seen = []
    async def client_tool_fn(name, input):
        seen.append(name)
        return {"ok": True, "output": ["sky"]}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="list", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 2}
    assert seen == ["list_objects"]


@pytest.mark.asyncio
async def test_loop_stops_at_max_tool_calls():
    # LLM keeps asking for a client tool forever.
    forever = [_Resp("tool_use", [_Block("tool_use", "list_objects", {}, f"tu_{i}")]) for i in range(20)]
    llm = _ScriptedLLM(forever)

    async def propose_fn(target_image_node_id, intent):
        return {"ok": True, "widget_count": 0}

    async def client_tool_fn(name, input):
        return {"ok": True, "output": []}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="loop", attached_objects=[],
        client_tools=[], node_layers={}, propose_fn=propose_fn, client_tool_fn=client_tool_fn,
        max_tool_calls=3,
    )
    assert out == {"ok": True, "tool_calls": 3}
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_run.py -q`
Expected: FAIL — `run_agent_turn` not defined.

- [ ] **Step 3: Implement `run_agent_turn`**

In `backend/app/tools/agent_loop.py`, add:

```python
_PROPOSE_TOOL_NAME = "propose_adjustment_widgets"

# The propose_adjustment_widgets tool the backend adds to the Anthropic tools
# list (the client tools come serialized from the frontend).
PROPOSE_ADJUSTMENT_TOOL = {
    "name": _PROPOSE_TOOL_NAME,
    "description": (
        "Propose a stack of adjustment widgets for an intent on a specific image "
        "node. Use after any structural setup (e.g. extracting an object). The "
        "widgets stream to the canvas; you get back a count."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "target_image_node_id": {"type": "string", "description": "Image node to edit."},
            "intent": {"type": "string", "description": "What to change, e.g. 'make it dramatic'."},
        },
        "required": ["target_image_node_id", "intent"],
    },
}


def _build_system(attached_objects: list[str]) -> str:
    base = (
        "You are an editing agent for a photo editor. Use the provided tools to "
        "fulfil the user's request. Call propose_adjustment_widgets to apply "
        "adjustments to an image node. Stop when the request is satisfied."
    )
    if attached_objects:
        base += (
            "\n\nThe user pinned these object/mask ids as context: "
            + ", ".join(attached_objects)
            + ". Prefer acting on them."
        )
    return base


async def run_agent_turn(
    *,
    agent_step,
    sid: str,
    intent: str,
    attached_objects: list[str],
    client_tools: list[dict],
    node_layers: dict[str, list[str]],
    propose_fn,
    client_tool_fn,
    max_tool_calls: int = 10,
) -> dict[str, Any]:
    """Run the multi-turn Anthropic tool-use loop. Holds NO write-lock.

    - agent_step(system, messages, tools) -> response (one Anthropic turn)
    - propose_fn(target_image_node_id, intent) -> dict  (Task 3 dispatch)
    - client_tool_fn(name, input) -> dict               (Plan 1 round-trip)
    """
    system = _build_system(attached_objects)
    tools = [*client_tools, PROPOSE_ADJUSTMENT_TOOL]
    messages: list[dict[str, Any]] = [{"role": "user", "content": intent}]
    tool_calls = 0

    while tool_calls < max_tool_calls:
        response = agent_step(system, messages, tools)
        if getattr(response, "stop_reason", None) != "tool_use":
            break

        # Record the assistant's tool_use turn verbatim so the follow-up
        # tool_result messages correlate.
        tool_uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        messages.append({
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                for b in tool_uses
            ],
        })

        results: list[dict[str, Any]] = []
        for block in tool_uses:
            tool_calls += 1
            if block.name == _PROPOSE_TOOL_NAME:
                node = (block.input or {}).get("target_image_node_id", "")
                layer_ids = node_layers.get(node)
                if layer_ids is None:
                    result = {"ok": False, "error": f"unknown image node {node!r}"}
                else:
                    result = await propose_fn(node, (block.input or {}).get("intent", intent))
            else:
                result = await client_tool_fn(block.name, block.input or {})
            results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": _json(result),
            })
            if tool_calls >= max_tool_calls:
                break

        messages.append({"role": "user", "content": results})

    return {"ok": True, "tool_calls": tool_calls}


def _json(obj: Any) -> str:
    import json
    return json.dumps(obj)
```

- [ ] **Step 4: Run loop tests, verify pass**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_run.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `agent_message` to the Anthropic client**

In `backend/app/services/anthropic_client.py`, add a method to the client class (near the other `_messages_create` callers). Use the existing model/token config the class already reads (mirror an existing call's `model=` / `max_tokens=` args):

```python
    def agent_message(self, system: str, messages: list, tools: list):
        """One turn of the agent tool-use loop. Returns the raw Anthropic
        response (caller inspects .stop_reason and .content blocks)."""
        return self._messages_create(
            model=self._runtime.model,
            max_tokens=2048,
            system=system,
            messages=messages,
            tools=tools,
        )
```

> If `self._runtime.model` is not the attribute used elsewhere in this file,
> copy the exact `model=` expression from an existing `_messages_create` call
> in this file (e.g. the `plan_widget_stack` call).

- [ ] **Step 6: Commit**

```bash
git add backend/app/tools/agent_loop.py backend/app/services/anthropic_client.py backend/tests/tools/test_agent_loop_run.py
git commit -m "feat(agent): multi-turn run_agent_turn loop + agent_message"
```

---

### Task 5: The `POST /state/{sid}/agent_turn` endpoint (non-locking)

**Files:**
- Modify: `backend/app/api/state.py` (request model + route)
- Create: `backend/tests/api/test_agent_turn.py`

**Interfaces:**
- Consumes: `run_agent_turn` (Task 4); `dispatch_propose_adjustment` (Task 3); `request_client_tool` (Plan 1); `deps.get_session_store`, `deps.get_event_bus`, `deps.get_anthropic_client`, `deps.get_tool_registry`.
- Produces: `POST /api/state/{sid}/agent_turn` with `{intent, attached_objects, client_tools}` → `{ok, tool_calls}`. Resolves the active image node's `layer_ids` from the document and seeds `node_layers`. Registers the loop task for cancellation. Holds NO write-lock around the loop.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/api/test_agent_turn.py`:

```python
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.api import deps


def test_agent_turn_runs_loop_and_returns_count():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")

    async def fake_run_agent_turn(**kwargs):
        # Assert the endpoint wired the curated tools + propose tool is added inside the loop.
        assert kwargs["sid"] == sid
        assert kwargs["intent"] == "dramatic"
        return {"ok": True, "tool_calls": 2}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={"intent": "dramatic", "attached_objects": ["mask_sky"], "client_tools": []},
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "tool_calls": 2}


def test_agent_turn_unknown_session_404():
    client = TestClient(app)
    resp = client.post(
        "/api/state/nope/agent_turn",
        json={"intent": "x", "attached_objects": [], "client_tools": []},
    )
    assert resp.status_code == 404
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_agent_turn.py -q`
Expected: FAIL — 404 for the first test (route missing).

- [ ] **Step 3: Implement the endpoint**

In `backend/app/api/state.py`, add imports near the top:

```python
from app.tools.agent_loop import run_agent_turn, dispatch_propose_adjustment
from app.tools.client_tool_bridge import request_client_tool
from app.state.document import DEFAULT_IMAGE_NODE_ID
```

Add the request model below `_ToolResultBody`:

```python
class _AgentTurnBody(BaseModel):
    intent: str
    attached_objects: list[str] = []
    client_tools: list[dict] = []
```

Add the route (after `state_tool_result`):

```python
@router.post("/state/{sid}/agent_turn")
async def state_agent_turn(sid: str, body: _AgentTurnBody) -> dict:
    """Run an agentic palette turn — a multi-turn Anthropic tool-use loop. Holds
    NO write-lock: sub-mutations go through registry.invoke (brief locks) and
    client tools through request_client_tool. The active image node's layer ids
    seed node_layers so propose_adjustment_widgets can scope correctly."""
    store = _store()
    bus = _bus()
    try:
        store.touch(sid)  # 404 if the session is unknown; no lock held into the loop.
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    # Plan-2 stand-in: target the default image node. Plan 3 replaces this with
    # real per-node layer ids and adds extract-created nodes (see CARE POINT).
    node_layers = {DEFAULT_IMAGE_NODE_ID: [DEFAULT_IMAGE_NODE_ID]}

    from app.api import deps
    anthropic = deps.get_anthropic_client()
    registry = deps.get_tool_registry()

    async def propose_fn(target_image_node_id: str, intent: str) -> dict:
        return await dispatch_propose_adjustment(
            registry, sid, target_image_node_id=target_image_node_id,
            layer_ids=node_layers.get(target_image_node_id, []), intent=intent,
        )

    async def client_tool_fn(name: str, input: dict) -> dict:
        return await request_client_tool(store, bus, sid, name=name, input=input, kind="mutate")

    result = await run_agent_turn(
        agent_step=anthropic.agent_message,
        sid=sid, intent=body.intent, attached_objects=body.attached_objects,
        client_tools=body.client_tools, node_layers=node_layers,
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    return result
```

> CARE POINT: `layer_ids`/`node_layers` here use `DEFAULT_IMAGE_NODE_ID` as a
> stand-in for the active node's layer set. Plan 3 replaces this with the real
> per-node layer ids (and adds extract-created nodes to `node_layers`). For
> Plan 2 the loop targets the default node, which is sufficient to exercise the
> full agentic path end-to-end. Also: `client_tool_fn` passes `kind="mutate"`
> conservatively; the frontend is authoritative on kind (Plan 1) and will
> auto-run query tools regardless — the backend kind only affects nothing here
> because the client decides. (If a future refinement wants query tools to skip
> the approval UI server-side, thread the manifest kind through.)

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_agent_turn.py -q`
Expected: PASS (2 tests).

```bash
git add backend/app/api/state.py backend/tests/api/test_agent_turn.py
git commit -m "feat(agent): POST /state/{sid}/agent_turn endpoint (non-locking)"
```

---

### Task 6: Wire the palette agent-mode prompt to `runAgentTurn`

**Files:**
- Modify: `src/components/CommandPalette.tsx` (the `cmd.kind === 'ai'` submit path)
- Create: `src/components/CommandPalette.agent.test.tsx`

**Interfaces:**
- Consumes: `runAgentTurn` (Task 2).
- Produces: when the user submits the AI row in agent mode with `aiAccess`, the palette calls `runAgentTurn(prompt, attachedObjectIds)` instead of `proposeFromPalette`. `attachedObjectIds` = the attached-context chips whose `sourceId` looks like an object (`region:object:<id>` / `region:ai:<label>`). Toolrail `tool_invoked` and preset paths are untouched (they don't go through this row).

- [ ] **Step 1: Write the failing test**

Create `src/components/CommandPalette.agent.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { extractAttachedObjectIds } from './CommandPalette.agent-helpers';

describe('extractAttachedObjectIds', () => {
  it('pulls object/mask ids from object-flavored chips, ignores others', () => {
    const ids = extractAttachedObjectIds([
      { id: 'a', label: 'Region', value: 'Sky', sourceId: 'region:object:mask_sky' },
      { id: 'b', label: 'Region', value: 'Tree', sourceId: 'region:ai:tree' },
      { id: 'c', label: 'Image', value: 'photo.jpg', sourceId: 'imageNode:in-1' },
    ]);
    expect(ids).toEqual(['mask_sky', 'tree']);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/components/CommandPalette.agent.test.tsx`
Expected: FAIL — cannot find module `./CommandPalette.agent-helpers`.

- [ ] **Step 3: Implement the helper**

Create `src/components/CommandPalette.agent-helpers.ts`:

```ts
/** Pull object/mask ids out of attached-context chips. Chips are sourced as
 *  `region:object:<maskId>` (committed objects) or `region:ai:<label>`
 *  (AI-proposed regions); both carry the identifier in the last `:` segment.
 *  Non-region chips (e.g. `imageNode:...`) are ignored. */
export function extractAttachedObjectIds(
  items: Array<{ sourceId?: string }>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const src = item.sourceId ?? '';
    if (src.startsWith('region:object:')) out.push(src.slice('region:object:'.length));
    else if (src.startsWith('region:ai:')) out.push(src.slice('region:ai:'.length));
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/components/CommandPalette.agent.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the submit path**

In `src/components/CommandPalette.tsx`, add the imports:

```ts
import { runAgentTurn } from '@/lib/palette-actions.agent';
import { extractAttachedObjectIds } from './CommandPalette.agent-helpers';
```

In the `run` callback's `cmd.kind === 'ai'` branch, REPLACE the existing
`const result = await proposeFromPalette(submitted, scope, attachedContext);`
line (and its `if (result.ok)` handling) with a call that routes through the
agent loop when `aiAccess` is on:

```ts
        const objectIds = extractAttachedObjectIds(attachedContext);
        const turn = await runAgentTurn(submitted, objectIds);
        if (turn.ok) {
          setPending(null);
          setPendingPhase(null);
          resetPalette();
          setOpen(false);
        } else {
          setPending(null);
          setPendingPhase(null);
          setErrorState({ message: 'The agent could not complete that request.' });
        }
```

(Leave the earlier `analyseActiveImageLayer()` auto-analyze guard in place — the
agent still needs image context. Keep `scope` computed above for the analyze
gate even though the loop derives its own targets.)

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`
Expected: green.

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.agent-helpers.ts src/components/CommandPalette.agent.test.tsx
git commit -m "feat(agent): palette agent-mode prompt runs the agent loop"
```

---

## Final verification

- [ ] **Backend:** `cd backend && source .venv/bin/activate && python -m pytest tests/ -q` — all pass except the pre-existing `test_prune_disk_removes_old_records`.
- [ ] **Frontend:** `npm run check` — exit 0.

## Self-review notes (coverage vs spec §3.B/E/F)

- §3.B agent loop: Task 4 (`run_agent_turn`) + Task 5 (endpoint, non-locking) + `agent_message` (Task 4 step 5). ✔
- §3.B `propose_adjustment_widgets` as a tool dispatched to propose_stack: Task 3 + Task 4's dispatch. ✔
- §3.E chip → structured `attached_objects`: Task 2 (request) + Task 6 (extract ids + system prompt mention in Task 4). ✔
- §3.F curated tool set: Task 1 (`serializeForAgentLoop`) + `AGENT_LOOP_TOOLS` (Task 2). ✔
- §3.G bounds: max_tool_calls (Task 4); timeout/cancel inherited from Plan 1. ✔
- §7 lock scoping: orchestrator holds no lock; sub-mutations via `registry.invoke`; lock released before the loop (Task 5). ✔
- **Deferred to Plan 3:** real per-node `layer_ids` + extract-created nodes in `node_layers`; extract backend-registration; the new-node targeting. Task 5 CARE POINT documents the Plan-2 stand-in.

## Follow-up

- **Plan 3** — `extract` backend-registration + id-flow + real `node_layers` (so the LLM can extract → new node → edit it). Write via `superpowers:writing-plans` after Plan 2 ships.
