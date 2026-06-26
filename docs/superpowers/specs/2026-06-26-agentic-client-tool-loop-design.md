# Agentic Client-Tool Loop — Design Spec

**Date:** 2026-06-26
**Status:** Approved (pending spec review)
**Scope:** Frontend (`src/`) + local backend (`backend/`)

## 1. Summary

Today a command-palette AI prompt is **single-shot**: the frontend POSTs to
`propose_stack`, the backend makes one `plan_widget_stack()` Anthropic call,
resolves params, and streams the resulting widgets back over SSE. The LLM
cannot take actions — it can only emit a plan of adjustment ops.

This feature makes the palette prompt **agentic**: the backend runs a multi-turn
Anthropic tool-use loop where the LLM can invoke the editor's existing
client-side tools (`extract_object_to_image_node`, `select_object`, …) *and* a
new `propose_adjustment_widgets` tool. The motivating flow:

> User attaches an object chip ("Sky") and prompts "make it dramatic on its own
> layer" → the LLM calls `extract_object_to_image_node` (→ new image node) →
> then calls `propose_adjustment_widgets` targeting that new node.

This is the thesis USP (AI composing/invoking the block-kit tools). It requires
building three things that **do not exist today**: a backend↔client tool-call
round-trip transport, a multi-turn agent loop, and client-tool-manifest sharing.

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | Full agentic client-tool loop (the USP), not a narrow hardwired flow. |
| Loop architecture | One unified loop; **`propose_adjustment_widgets` becomes a tool** alongside the client tools. The LLM orchestrates freely (extract → propose on new node). |
| Mutation autonomy | **Approve each mutate call.** `query` tools auto-execute; `mutate` tools pause for user allow/deny (reuse the suggestion-chip pattern). |
| Undo granularity | The whole agent turn collapses to **one backend history entry** (single Cmd+Z reverts it). |
| extract → backend | The `extract_object_to_image_node` agent handler **uploads the cutout to the backend** and returns the backend `image_node_id`, so the LLM can target it. |
| v1 tool set | Curated (see §3.F). Annotation tools and `apply_adjustment` deferred. |

## 3. Architecture

### A. Transport — the backend↔client round-trip primitive

The one genuinely new piece of infrastructure. Today: HTTP POST up (one-shot),
SSE down (one-way), no correlation IDs. We add a request/response channel layered
on the existing transport.

- **Down (new SSE event):** `client.tool_request` with payload
  `{ request_id: str, name: str, input: object, kind: "query" | "mutate" }`.
  Add `"client.tool_request"` to the `StateEventKind` literal in
  `backend/app/schemas/widget.py` and `src/types/widget.ts` (they mirror).
- **Up (new endpoint):** `POST /api/state/{sid}/tool_result` with body
  `{ request_id: str, ok: bool, output?: object, error?: str, denied?: bool }`.
  Lives in `backend/app/api/state.py`.
- **Backend correlation:** a per-session `pending_tool_calls: dict[str, asyncio.Future]`
  on the `SessionRecord` (`backend/app/services/session_store.py`). The agent loop
  creates a `request_id`, registers a Future, emits the SSE event, and `await`s the
  Future with a timeout. The `tool_result` POST looks up the `request_id` and
  resolves the Future. Session cancel/disconnect (`POST /session/{sid}/cancel`,
  SSE close) rejects every pending Future and aborts the turn.

### B. The agent loop (backend)

Replaces the single-shot LLM path for palette agent-mode prompts. New backend
flow (extend `ProposeStackTool._handle_llm_path` in
`backend/app/tools/widgets/propose_stack.py`, or a sibling `AgentTurnTool` —
implementation plan decides) that runs a multi-turn Anthropic loop:

```
tools = serialized_client_manifests + [propose_adjustment_widgets]
messages = [opening context: image_context, attached_objects, user prompt]
loop (max 10 tool calls):
    resp = anthropic.message(tools=tools, messages=messages)
    if resp.stop_reason != "tool_use": break          # end_turn → done
    for block in resp.tool_use_blocks:
        if block.name == "propose_adjustment_widgets":
            result = run server-side (wraps plan_widget_stack → add_widget,
                     scoped to block.input.target_image_node_id)
        else:                                            # a client tool
            result = await round_trip(block.name, block.input, block.kind)
        messages.append(tool_result(block.id, result))
```

- **`propose_adjustment_widgets`** is a new backend tool: a thin wrapper over the
  existing `plan_widget_stack` + `resolve_widget_params` + `doc.add_widget`,
  parameterised by a `target_image_node_id` and the adjustment intent. It runs
  fully server-side (no round-trip) and reuses today's widget machinery.
- **Anthropic client:** add an agent-loop entrypoint to
  `backend/app/services/anthropic_client.py` that accepts `tools` and handles the
  multi-turn `tool_use` protocol (the current methods are all single-shot/emit-only).
- **Trace/streaming:** emit `phase.*` (and/or a new lightweight `agent.step` event)
  so the UI shows the running trace. The existing EventBus + SSE deliver them.

### C. Approval gating (per-step mutate)

Dispatch by the manifest `kind`:
- **`query`** (`get_image_context`, `list_objects`, `get_active_selection`,
  `select_object`): the frontend `client.tool_request` handler calls
  `LlmToolRegistry.execute(name, input)` immediately and POSTs the result.
- **`mutate`** (`extract_object_to_image_node`, `convert_object_to_layer_mask`):
  the handler renders an **allow/deny approval chip** (reuse the
  `src/components/ui/SuggestionChips.tsx` pattern / dock slot) — e.g.
  *"Extract object 'Sky' to a new node? ✓ / ✗"*. On **allow** → execute + POST
  `{ok:true, output}`; on **deny** → POST `{ok:false, denied:true}`. The LLM sees
  the denial in the tool_result and adapts or ends the turn.

`select_object` is `query`-ish (selection, no destructive mutation) — treat as
auto-execute. The plan should confirm each tool's `kind` against
`src/lib/tool-manifest/index.ts`.

### D. extract → backend registration + id flow (the wrinkle)

`extractObjectToImageNode` (`src/lib/segmentation/object-actions.ts:110`) is
**frontend-only today** — it bakes the cutout and calls `editor.addImageNode`,
but never uploads to the backend, so the backend has no node to target.

For the agent path, the `extract_object_to_image_node` **handler** must:
1. Bake the cutout (existing `extractLayerFromMask`).
2. **Upload it to `POST /api/session/{sid}/images`** (the pattern
   `src/core/document.ts:addImage` already uses; backend mints an `in-N`
   `image_node_id` via `backend/app/api/session.py:add_image_to_session`).
3. Create the workspace node (`addImageNode`).
4. **Return the backend `image_node_id`** in the tool result so the LLM passes it
   to `propose_adjustment_widgets(target_image_node_id=…)`.

This closes the known frontend-workspace-id vs backend-`in-N`-id mismatch for this
flow (noted as a "known gap" in `addImage`). The implementation plan must decide
whether to extend `extractObjectToImageNode` or add an agent-aware variant.

### E. Chip → structured scope

Object chips currently reach the backend only as a markdown preamble string
(`src/lib/palette-actions.ts:_formatContextPreamble`); the chip's `sourceId`
(mask id) is dropped. Add a structured field: when chips are attached, send
`attached_objects: [mask_id, …]` alongside the intent. The agent loop's opening
context states "the user is pointing at object X (mask id …)", letting the LLM
`select_object`/`extract_object_to_image_node` the right object.

### F. v1 tool set (curated)

| kind | tools |
|---|---|
| query | `get_image_context`, `list_objects`, `get_active_selection` |
| selection | `select_object` (auto-exec) |
| mutate (gated) | `extract_object_to_image_node`, `convert_object_to_layer_mask` |
| backend | `propose_adjustment_widgets` (new) |

**Deferred:** `highlight_region`, `add_note`, `apply_adjustment`,
`list_named_regions`, `select_named_region`, `clear_selection`, `list_layers`.
Manifest sharing serializes only the v1 set (`serializeAllManifests()` exists in
`src/lib/tool-manifest/serialize.ts`; add a filtered variant).

### G. Errors & safety

- **Per-tool timeout:** 60s (covers a mutate tool's user decision). Timeout →
  treated as `denied` so the loop continues/ends gracefully.
- **Max iterations:** 10 tool calls per turn → hard stop, return whatever widgets
  exist.
- **Tool failure:** the error string is fed back as the tool_result; the LLM may
  retry or abort. No crash.
- **Cancel/disconnect:** rejects pending Futures, aborts the loop.
- **Atomic undo:** the whole turn is one backend history entry.

### H. Testing

- **Backend:** drive the loop with a **mocked Anthropic** that emits scripted
  `tool_use` sequences (e.g. extract → propose). A fake client resolves Futures
  (allow, deny, timeout). Cover: round-trip correlation, deny path, timeout,
  max-iterations, `propose_adjustment_widgets` server-side path.
- **Frontend:** `client.tool_request` SSE handler (query auto-run vs mutate gate),
  `tool_result` POST, the extract-with-backend-upload, manifest serialization
  filter.

## 4. Data flow (the motivating example)

```
User: chip[Sky] + "make it dramatic on its own layer"  → POST <agent endpoint, §7>
  body: { intent, attached_objects:[mask_sky], client_tools:[…manifests…] }
backend agent loop:
  turn 1 → LLM: tool_use extract_object_to_image_node{maskId: mask_sky}  (mutate)
    → SSE client.tool_request{req_1, …, kind:mutate}
    → frontend: approval chip "Extract 'Sky' to new node?" → ✓
    → execute: bake → POST /session/{sid}/images → backend image_node_id "in-3"
            → addImageNode → POST /tool_result{req_1, ok, output:{image_node_id:"in-3"}}
    → Future resolves → tool_result fed back
  turn 2 → LLM: tool_use propose_adjustment_widgets{target:"in-3", intent:"dramatic"}
    → server-side: plan_widget_stack → resolve → doc.add_widget(scope=in-3)
    → widgets stream via SSE widget.created
  turn 3 → LLM: end_turn → done (one history entry for the whole turn)
```

## 5. Touch points (grounded)

- **New transport:** `backend/app/api/state.py` (POST `tool_result`),
  `backend/app/services/session_store.py` (pending-Future registry),
  `backend/app/schemas/widget.py` + `src/types/widget.ts` (`client.tool_request` kind),
  `src/store/backend-state-slice.ts` (SSE handler), `src/lib/backend-tools.ts`
  (POST helper).
- **Agent loop:** `backend/app/tools/widgets/propose_stack.py` or new
  `AgentTurnTool`; `backend/app/services/anthropic_client.py` (multi-turn entry);
  new `propose_adjustment_widgets` backend tool.
- **Manifest sharing:** `src/lib/tool-manifest/serialize.ts` (filtered serialize),
  `src/lib/palette-actions.ts` (send manifests + `attached_objects`).
- **Client execution + approval:** `src/lib/tool-manifest/llm-tool-registry.ts`
  (`execute`), `src/components/ui/SuggestionChips.tsx` (approval UI pattern),
  `src/lib/segmentation/object-actions.ts` (extract + backend upload).

## 6. Out of scope (v1)

- WebSocket upgrade (we stay on SSE-down + POST-up).
- Deferred tools (§3.F).
- Parallel tool calls in one turn (handle sequentially).
- Cost/budget UI beyond the existing usage meter.
- AI-on/off study gating interaction is unchanged — the whole loop sits behind
  `aiAccess` like the rest of the AI surfaces.

## 7. Risks / open questions for the plan

- **Lock duration:** the agent loop now awaits client round-trips (incl. human
  decisions) — must NOT hold the per-session write lock across the wait. Plan must
  define lock scoping (acquire only around `add_widget`, not the whole loop).
- **Stale state during the loop:** between `extract` and `propose`, the snapshot
  changes; ensure the LLM's `target_image_node_id` stays valid.
- **`agent_turn` vs reusing `propose_stack`:** decide whether the agentic path is a
  new tool/endpoint or an evolution of `propose_stack` (back-compat with the
  toolrail `tool_invoked` fast path, which must stay single-shot).
- **Trace event shape:** reuse `phase.*` or add `agent.step` — pick one in the plan.
