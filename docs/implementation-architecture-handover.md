# Implementation Architecture — Handover Brief

> **Purpose.** This file is a long-form, exhaustive briefing for a *second* agent
> (or thesis author) who must write narrative text about how this photo editor is
> built and **why** every load-bearing decision was made the way it was. It is
> not source code, not a tutorial, and not a marketing overview. Treat every
> "**Entscheidung**" (decision) block as material that should appear in the
> written-up text with its argument intact.
>
> The repository already carries two architecture docs — `docs/architecture-overview.md`
> (1-page) and `docs/architecture-detailed.md` (Mermaid-heavy). This document
> *combines and expands* them: same mental model, every box opened up.

---

## 0 · One-sentence summary

This is a **browser-based, non-destructive photo editor** whose pixel-affecting
state lives in a **stateful FastAPI backend**, whose pixel-rendering happens in
the browser through a **per-layer WebGL pipeline composited on the GPU**, and
whose **AI affordances (widgets) are minted by the backend, transported via
SSE, and tethered onto a React Flow canvas** alongside the image. The two
processes communicate over REST tools (frontend → backend) and a single SSE
stream (backend → frontend). One JSON registry on disk (`shared/registry/`)
defines every operation, parameter, range, and shader binding for *both*
runtimes.

---

## 1 · The doctrine that drives everything: Engine-SSoT

A single rule produces ~80 % of the architecture:

> **The backend owns every value that affects pixels.** The frontend reads that
> state, displays it, and asks the backend to change it through tool calls. It
> never invents an adjustment value of its own.

Translated to ownership:

| Owner | Responsibility |
|---|---|
| **Backend `SessionDocument`** | `canonical` (the SSoT), `operation_graph` (projection), `widgets`, `image_context`, `masks`, `image_node_transforms`, `history` |
| **Frontend `EditorStore` (Zustand)** | layer metadata (id/name/order/visibility/blend/opacity/parentLayerId/layerMask), viewport, selection, expanded/hovered widget UI state, optimistic patches |
| **Frontend `pixelStore` / `CanvasRegistry`** | raw source bitmaps + working `OffscreenCanvas`es per layer (never serialised into Zustand) |

#### Entscheidung 1 — Why a stateful backend at all (instead of doing everything in the browser)?

- **Thesis claim is "AI composes working widgets from a block kit."** That
  composition step needs an LLM, a deterministic tool registry, and structured
  state the LLM can mutate. Doing it in the browser would mean shipping an
  Anthropic key to clients and re-inventing a session model in JS.
- **Reproducibility for evaluation.** A session has a `revision` integer and an
  event log; an undo step is `op_graph(revision N-1)`. The thesis can replay any
  user session deterministically.
- **One brain, multiple surfaces.** REST exposes the same tools as the MCP
  transport — that gives a clean substrate for both the UI and the LLM. The
  frontend is "just another tool consumer."
- **Image-intelligence latency.** SAM 2 embeddings + Claude vision calls are
  ~seconds; they have to live next to a real Python runtime, not behind a fetch.

#### Entscheidung 2 — Why mirror state on the frontend (instead of letting the backend push pixels)?

- Sliders must feel instant. A 100 ms round-trip per drag would be unusable.
  → **Optimistic patches in `BackendState.optimistic`** move pixels at 60 fps
  while the debounced backend call is in flight; the SSE reconciliation drops
  the patch when the authoritative snapshot catches up.
- Rendering on the backend would require streaming compressed images per frame —
  prohibitive over local dev let alone over a network.
- The browser already has the GPU. We use it.

#### Entscheidung 3 — Why "one slot per (layer, op)" in canonical (not a free-form node list)?

- A user editing "exposure on Layer 2" must move *one* value, not append a
  fifth exposure node. The canonical store is `dict[layer_id][op][param] →
  value`; `canonical_to_nodes` projects it to a deduplicated operation_graph.
  Multiple writes to the same triple **overwrite**, which is exactly what an
  adjustment surface expects.
- The op-graph node id is *derived*: `canon:<layer>:<op>`. That makes IDs stable
  across edits, which lets the frontend key optimistic patches on them safely.

---

## 2 · Topology of the system

```
┌──────────────────────────────────────┐     REST tool call    ┌─────────────────────────────────────┐
│        FRONTEND (Vite, React 19)     │ ────────────────────▶ │       BACKEND (FastAPI, Py 3.11+)    │
│                                      │                       │                                     │
│  ┌── React Flow workspace           │ ◀──────── SSE stream ──┤  ┌─ ToolRegistry (REST + MCP)        │
│  │   • ImageNode (WebGL <canvas>)   │   state events         │  ├─ SessionDocument (canonical, ops, │
│  │   • WidgetNode (WidgetShell)     │                        │  │  widgets, masks, image_context)   │
│  │   • TetherEdge (attribution)     │                        │  ├─ EventBus → SSE encoder           │
│  ├── Inspector / Toolbar / Layers   │                        │  ├─ SAM 2 client (MPS/CUDA/CPU)      │
│  ├── EditorStore (Zustand slices)   │                        │  ├─ Anthropic client + prompt cache │
│  ├── BackendState (snapshot mirror) │                        │  └─ Disk session checkpointer       │
│  └── pixelStore (OffscreenCanvas)   │                        │                                     │
│                                      │                       │                                     │
│  reads shared/registry/ops/*.json ──┼────┐                   │  reads shared/registry/ops/*.json   │
└──────────────────────────────────────┘    │                  └─────────────────────────────────────┘
                                            ▼
                              shared/registry — SSoT for ops, params, shaders
```

#### Entscheidung 4 — Why two transports (REST + SSE) instead of one WebSocket?

- **REST is request/response with status codes and typed envelopes** — fits
  "invoke a tool, get a result" cleanly. WebSockets blur error semantics.
- **SSE is one-way server-push with a `Last-Event-ID` replay protocol baked in.**
  We exploit that protocol: the browser auto-reconnects with `Last-Event-ID`
  and the backend replays from `doc.history`. If history was pruned past the
  client's last id, the backend emits a synthetic `state.gap` event and the
  frontend `fetchSnapshot()`s.
- One bidirectional channel would mean re-implementing this resilience by hand.

---

## 3 · The shared registry (`shared/registry/`)

A directory of JSON files (one per op) and presets, plus a TS schema:

```
shared/registry/
  ops/      light.json, color.json, hsl.json, curves.json, levels.json,
            kelvin.json, sharpen.json, blur.json, clarity.json, grain.json,
            vignette.json, splitTone.json, time-of-day.json, age.json,
            mood.json, season.json, weather.json   (17 ops total)
  presets/  golden_hour.json, sky_recovery.json, teal_orange.json, …
  lib/      interpolate-1d.ts   (shared 1-D interpolation used by both runtimes)
  schema.ts (canonical TS types)
```

A single op file (light.json) declares:

```jsonc
{
  "id": "light",
  "category": "tone",
  "llm": { "description": "...", "typical_use": "...", "semantic_tags": [...] },
  "params": { "exposure": { "type": "scalar", "range": [-100, 100], "default": 0 }, ... },
  "bindings": [ { "paramKey": "exposure", "controlType": "slider", "label": "Exposure" }, ... ],
  "engine":  { "shader": "basic", "render_order": 10, "node_type": "basic" },
  "tool_defaults": ["exposure", "contrast", "highlights", "shadows"]
}
```

Both runtimes load this file:
- **Frontend** — `src/lib/registry/loader.ts` → `src/engine/registry.ts`
  derives `EngineOp`, `EngineParam`, slider min/max/step, default values and a
  `SHADER_PARAM_META` table that maps each param to a uniform name + scale
  factor for the WebGL shaders.
- **Backend** — `backend/app/registry/loader.py` materialises a `Registry`
  with `ops + presets`. `tool_defaults` (the curated subset the toolrail
  ships) and `tool_defaults.py` derive from the same file. `EDITOR_OP_MODULES`
  env var lets ops be flagged "experimental" and excluded by default.

#### Entscheidung 5 — Why a shared JSON registry instead of duplicating constants?

- The frontend slider min/max, the shader uniform scale, the backend default,
  and the LLM tool description **cannot drift**. Drift would look like a
  slider snapping unexpectedly, a shader saturating, or the LLM proposing an
  out-of-range param.
- It also makes the system **extensible**: adding `vignette.json` to the
  directory and registering one frontend processing definition makes the op
  appear in the inspector, the LLM's tool manifest, the shader pipeline, and
  the backend's canonical validation in one commit.
- JSON over TS so the backend (Python) reads the *same byte sequence* the
  frontend reads — no codegen step, no schema gap.

A generated TypeScript type bundle (`shared/types/generated.ts`) is *separately*
produced via `npm run gen:types` from Python Pydantic schemas; `gen:types:check`
is wired into `npm run check` to fail CI if drift creeps in.

---

## 4 · Backend internals

### 4.1 Modules at a glance

| Area | Files |
|---|---|
| API | `app/api/{session,tools_rest,state,analyze,panel,refine,segment}.py` |
| Tool registry | `app/tools/registry.py`, `app/tools/base.py` (`ToolPermissions`) |
| Atomic tools | `app/tools/atomic/{prepare_image,analyze_context,select_by_point,…,combine_masks,suggest_widgets}.py` |
| Widget tools | `app/tools/widgets/{propose_stack,set_param,set_widget_param,accept,delete,refine,repeat,restore,unlock}.py` |
| Fused tools | `app/tools/fused/*` (templates), `app/tools/fused_framework.py` |
| State | `app/state/{document,canonical,operations,snapshot,events,active_doc,preview_renderer,context_stats,region_stats}.py` |
| Session | `app/services/session_store.py`, `app/session/{checkpointer,history,persistence,revive}.py` |
| Anthropic | `app/services/anthropic_client.py` |
| SAM | `app/services/sam_client.py` (SAM 2.1; SAM 3 future-stub kept) |
| Schemas | `app/schemas/{widget,image_context,operation_graph,errors,scope,…}.py` (Pydantic) |
| Config | `app/config/runtime.py` (timeouts, token budgets, prune intervals, etc.) |

### 4.2 `SessionDocument` — the unit of state

A `SessionDocument` is *the* authoritative object per session. Pydantic, frozen
schema, every mutation bumps `revision` and emits one or more `StateEvent`s on
`EventBus`. Notable fields:

- `image_bytes` + `image_bytes_by_node` — primary image plus per-ImageNode
  storage. The "legacy singleton" path still backs `in-default`; new callers
  go through per-node accessors so multi-image editing is *not* gated on a
  big-bang refactor.
- `image_context` (+ `image_context_by_node`) — the Claude-vision precomputed
  description of the image: regions, palette, problems, semantic tags.
- `prepare_result` — output of `prepare_image` (the cheap-pass + SAM-embed
  step). Cached so subsequent tools don't re-do it.
- `canonical: Canonical` — the SSoT for adjustment values, projected to
  `operation_graph` via `canonical_to_nodes()`.
- `widgets: dict[str, Widget]` + `widget_order: list[str]` — minted widgets,
  whether AI- or tool-spawned.
- `image_node_transforms` — per-ImageNode `{layer_ids, crop, rotate}`.
- `masks: dict[str, MaskRecord]` — SAM masks + their committed status.
- `history: list[StateEvent]` — the event log SSE replay reads from.
- `revision: int` — monotonic counter; surfaced in events so the frontend
  knows whether to apply or drop a delta.

#### Entscheidung 6 — Why one big document instead of separate stores per concern?

- Atomic snapshots. A user-visible state — "the document the editor is in
  right now" — must be **internally consistent**: a widget cannot reference an
  op_graph node that doesn't exist, an active mask cannot reference a deleted
  mask record. Pydantic models with `extra='forbid'` plus a single mutating
  surface make consistency a class invariant rather than a discipline.
- Cheap to ship. The whole document is small (image bytes excepted), so
  re-snapshotting on every event is fine. We don't need fine-grained
  per-collection deltas.

### 4.3 `canonical` → `operation_graph`

```python
# state/canonical.py
def set_param_value(canonical, layer_id, op, param, value): ...
def clear_param_value(canonical, layer_id, op, param) -> bool: ...
def canonical_to_nodes(canonical) -> list[dict]: ...
```

- `canonical[layer_id][op][param] = value` is the only mutable surface for
  pixel-affecting adjustments.
- `canonical_to_nodes` walks the nested dict in sorted layer-then-op order and
  emits `{ id: "canon:L:OP", type: OP, layer_id: L, params: {...} }`. Order
  determinism keeps event diffs stable.
- `operations.project_to_graph(doc)` takes that node list, plus
  `panel_bindings` and `user_goal` derived from active widgets, and produces a
  full `OperationGraph` for the snapshot.

#### Entscheidung 7 — Why projection (instead of storing the graph directly)?

- Two ways to express the same edit must always converge. Editing a slider
  (inspector → `set_param`) and editing a widget binding (`set_widget_param`)
  both end up in `canonical`. The graph is regenerated, never mutated
  in-place — so any combination of edits produces a single, canonical graph.
- Undo becomes trivial: revert `canonical` (and `widgets`) to a prior history
  step; the projection re-derives a consistent graph.

### 4.4 Tool registry & permissions

`BackendToolRegistry.invoke(name, session_id, raw_input)`:

1. Resolve `BackendTool` by name (or 400-equivalent `ToolError`).
2. `tool.input_schema.model_validate(raw_input)` — Pydantic validation.
3. Bootstrap tools (`create_session`) skip session resolution.
4. Otherwise: load the `SessionDocument` from `SessionStore`.
5. **Permission gate** (`ToolPermissions`):
   - `requires_image` — block until at least one image has been bootstrapped.
   - `requires_context` — block until `analyze_context` ran. *Skipped* for
     `tool_invoked` widget proposals (see Entscheidung 8).
   - `expose_mcp` / `expose_rest` — controls which transport surface lists the
     tool.
6. Run the handler with `set_active_doc(doc)`/`reset_active_doc()` framing so
   handlers can reach the active document without ferrying it everywhere.
7. Wrap typed exceptions (`_UnknownRegion`, `_SamFailed`, `_InvalidInput`,
   `_MissingContext`, …) into a `ToolResponseEnvelope { ok, output|error,
   error.code, error.message, error.retryable, error.recovery_hint }`.

#### Entscheidung 8 — Why bypass `requires_context` for `tool_invoked`?

When a user clicks "Light" on the toolrail they're invoking a non-AI default
("just open me a Light widget with TOOL_DEFAULTS"). Forcing them to wait for
`analyze_context` (a Claude vision call) before the panel appears would
introduce a 1–3 s delay for an operation that doesn't need an LLM at all. The
gate is intentionally *origin-aware*: prompts and autonomous suggestions still
require context, only the deterministic fast path skips it.

### 4.5 Three tool families

- **Atomic tools** — small, deterministic, no-LLM: `prepare_image`,
  `analyze_context`, `select_by_point`, `select_by_box`, `propose_mask`,
  `combine_masks`, `precompute_regions`, `set_image_node_transform`,
  `get_image_context`, etc. They are the building blocks both the UI and the
  fused tools call.
- **Widget tools** — `propose_stack`, `set_param`, `set_widget_param`,
  `accept_widget`, `delete_widget`, `refine_widget`, `repeat_widget`,
  `restore_widget`, `unlock_widget_param`. These are the user-visible
  vocabulary for editing.
- **Fused tools (LLM-driven templates)** — `warm_grade`, `cool_grade`,
  `teal_orange`, `sky_recovery`, `portrait_glow`, `subject_pop`, `tone_band`,
  …  Each is a template (`NodeSkeleton` + `BindingSkeleton`) that the LLM
  *resolves* into concrete params for the current image. Implemented in
  `tools/fused_framework.py` + `tools/fused/*`. Templates are listed via
  `list_fused_tools` so the LLM can pick.

### 4.6 EventBus → SSE

- `EventBus` is in-memory, per-session pub/sub.
- Each subscriber gets an `asyncio.Queue` capped at `_QUEUE_MAXSIZE = 1000`.
  Reaching the cap means the consumer is dead — the bus drops the queue and
  injects a synthetic `state.gap` event so the frontend refetches a full
  snapshot.
- Events: `state.snapshot`, `widget.created`, `widget.updated`,
  `widget.deleted`, `mask.created`, `phase.started` / `phase.completed` /
  `phase.cancelled`, `context.updated`, `state.gap`, `mcp.usage`, …
- Replay: `Last-Event-ID` lookup walks `doc.history` from the requested index;
  pruning past that index is what triggers `state.gap`.

### 4.7 Disk persistence

- `services/session_store.py` keeps `SessionDocument`s in memory.
- `session/checkpointer.py` flushes dirty docs to `.sessions/<sid>/...` on a
  configurable tick (`RUNTIME.checkpoint_interval_s`).
- `session/revive.py` reloads all on-disk sessions at startup.
- A background `_session_prune_loop` sweeps in-memory and on-disk stale
  sessions on `RUNTIME.disk_prune_interval_s`.

#### Entscheidung 9 — Why disk persistence at all?

- A backend restart in the middle of a dev session would otherwise lose every
  Anthropic call's work (analyze, autonomous suggestions). With revive, you
  reload the same browser tab and resume verbatim.
- Source bytes live in the doc — so a 200 MB session does *not* fit in RAM
  forever. The pruner keeps that honest.

### 4.8 Anthropic client

`services/anthropic_client.py` is a thin wrapper that:
- Caches the system prompt block with `cache_control: { type: 'ephemeral' }`.
- Caches the image bytes block as well (vision inputs are also cache-friendly).
- Logs hit/miss stats per call for cost visibility.
- Honors per-call token budgets from `RUNTIME` (`max_tokens_analyze`,
  `_compose`, `_refine`, `_classify`, `_short`).

The image context is **pre-computed once on load** (`analyze_context`) and
reused via prompt cache for every subsequent fused-tool resolver call. This is
the memory-noted decision from `project_ai_image_context.md`: pay the vision
cost once, get sub-second LLM responses for the rest of the session.

### 4.9 SAM 2 + segmentation

- Default backend uses Meta's SAM 2.1 image predictor
  (`services/sam_client.py`) with `mps`/`cuda`/`cpu` auto-pick. A `SAM 3`
  future stub is kept side-by-side so the upgrade is a single import flip.
- The frontend also has an on-device path (`onnxruntime-web` + MobileSAM ONNX)
  via `useMobileSam` — see `make download-sam` in the README.

---

## 5 · Frontend internals

### 5.1 Slice layout

```
EditorStore (Zustand + Immer)
  ├─ layer-slice         layers (metadata only — no pixels)
  ├─ tool-slice          activeTool, editorMode, expandedWidgetIds, hoveredWidgetId
  ├─ viewport-slice      zoom, pan, canvas dims
  ├─ document-slice      document meta (title, dirty flag, …)
  ├─ segmentation-slice  encoder state, click points, modal state
  ├─ selection-slice     unified selection (activeScope, hoveredScope,
                         focusedWidgetId, cycleStack, pendingBind)
  └─ workspace-slice     React-Flow state: imageNodes, widgetNodes,
                         tetherEdges, activeImageNodeId, info nodes

BackendState (separate store; not part of EditorStore)
  ├─ sessionId
  ├─ snapshot                 (full SessionStateSnapshot mirror)
  ├─ optimistic               Map<WidgetId | canonNodeId, OptimisticPatch>
  ├─ sseStatus                'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
  ├─ phases                   per-phase status of in-flight analyze
  ├─ usage                    cumulative token usage of current analyze
  ├─ mcpAnalyzeComplete       terminal phase flag
  └─ mcpAnalyzeCancelled      user-cancelled run flag

pixelStore (Map) + CanvasRegistry
  Per-layer { source: OffscreenCanvas, working: OffscreenCanvas, pre-crop: OffscreenCanvas? }
```

#### Entscheidung 10 — Why split `BackendState` from `EditorStore`?

- **Lifetime difference.** `BackendState` resets on session change, on SSE
  reconnect, on `state.gap`. `EditorStore` survives sessions (it holds UI
  state and layer metadata not owned by the backend).
- **Subscription cost.** Most components subscribe to one or the other. A
  combined store would re-render Inspector panels every time `sseStatus`
  flipped, and the toolrail every time `expandedWidgetIds` changed.
- **Optimistic patches are messy.** Keeping them in a dedicated mirror store
  makes their lifecycle (apply → reconcile-on-snapshot → drop) a *local*
  invariant.

#### Entscheidung 11 — Why pixel data outside Zustand?

- `OffscreenCanvas` is not JSON-serialisable. Immer would try to draft it on
  every state change, exploding the cost of `set`.
- Pixel updates happen at 60 fps during a drag; they cannot route through
  React state.
- `CanvasRegistry` is a plain `Map<LayerId, { source, working, … }>`. Layer
  lifecycle (`core/layer-lifecycle.ts`) wipes entries when a layer is
  removed, so leaks are not a class of bug.

### 5.2 Render pipeline

```
              ┌────────────┐
              │ EditorStore│   (layer order, visibility, blend, opacity)
              └─────┬──────┘
                    ▼
┌─────────────┐  per-layer  ┌────────────────────┐  composite-then-apply
│CanvasRegistry├──────────▶│ PipelineManager     │──────────┐
│  source/    │  source    │ (WebGL ping-pong)   │          │
│  working    │            │ reads node.params   │          ▼
└─────────────┘            │ from operation_graph│   ┌────────────────┐  overlays
                           │ filtered by layer_id│   │image-node-     │──▶ visible <canvas>
                           └──────────┬──────────┘   │ renderer       │
                                      │  composite   │ (2D blend +    │
                                      ▼              │  node-scope    │
                            ┌──────────────────┐     │  pass + geom)  │
                            │ LayerCompositor  │────▶│                │
                            │ (2D ctx,         │     └────────────────┘
                            │  blend modes)    │
                            └──────────────────┘
```

- **`PipelineManager`** owns a single `WebGLPipeline` instance, RAF-batches
  render requests, and exposes `subscribe()` so panels (e.g. the Levels
  histogram) can mirror its output canvas.
- **`WebGLPipeline`** (in `shaders/pipeline.ts`) chains shader passes through
  two ping-pong framebuffers. Each pass binds uniforms via the
  `SHADER_PARAM_META` map.
- **`LayerCompositor`** draws per-layer GL output onto a shared 2D canvas with
  the configured blend mode + opacity.
- **`image-node-renderer.ts`** orchestrates the *node-scope* path: when a node
  in `operation_graph.nodes[].layer_ids` covers layers in this image node, the
  per-layer composite is computed first, then *fed back* into the
  `PipelineManager` to apply the node-scope shader to the composite. Overlays
  (mask fills, mask outlines, segmentation chrome) render *after* on a 2D
  context so they always stay on top.
- **`overlay-painters.ts`** is the pure 2D-drawing module (mask outline,
  segmentation overlay, full-image outline).

#### Entscheidung 12 — Why per-layer WebGL + 2D Canvas composite (instead of one mega-shader)?

- **Blend modes are non-trivial.** Implementing all eight blend modes
  (multiply, screen, overlay, …) in GLSL is correct but ugly; the browser
  ships them tested and accelerated in 2D `globalCompositeOperation`.
- **Compositing a node-scope adjustment after layer compositing** is exactly
  the semantic the user expects (a vignette over the *flattened* result, not
  on each layer). Composite-then-apply names it precisely.
- **Cheap to add a layer.** A new layer is a new `OffscreenCanvas` + one more
  pass through the same pipeline; no shader has to change.

### 5.3 Shaders

`src/shaders/*.glsl.ts` exports GLSL as tagged template literals. Inventory:
`basic-adjustments` (light + color), `hsl`, `curves`, `levels`, `kelvin`,
`lut` + `lut-filter`, `blur`, `sharpen`, `clarity`, `grain`, `vignette`,
`split-tone`, `mask-snippet` (shared mask masking-block).

#### Entscheidung 13 — Why GLSL in TS template literals?

- One-file-per-shader, hot-reloadable through Vite, IDE shows the source.
- Avoids the build complexity of a `.glsl` loader.
- Easy to share constants (the `mask-snippet` is reused inside every shader
  that supports a mask without copying).

### 5.4 React Flow canvas (`components/workspace/`)

Three node/edge types carry all visible workspace state:

- **`ImageNode`** — a `.overlay`-styled card with header (icon · name · `N
  LAYERS`), body `<canvas>` driven by `useImageNodeRender`, footer (`w × h ·
  Layer N`). When selected, a stack strip and split/menu affordance appear.
  Each node anchors an `ImageNodeSelectionPopover` (create layer / discard)
  when a committed mask sits inside its layers.
- **`WidgetNode`** — a thin wrapper that renders the unchanged `WidgetShell`
  as its body.
- **`TetherEdge`** — bezier curve in `--color-accent`. Solid for layer-scope
  tethers; dashed (`stroke-dasharray="3 3"`) for node-scope tethers. Tethers
  carry **attribution only** — no DAG semantics, no data flow.

Soft auto-layout: `workspace-layout.ts` provides
`nextSpawnPositionFor`/`pickSpawnSide` — places a new node one slot to the
right of the target with a 24 px gap, shifting down to clear collisions. After
placement, users drag freely.

Selection: `onSelectionChange` mirrors the single-image-node selection into
`activeImageNodeId` on the workspace slice. A `WorkspaceKeyHandler`
short-circuits `Delete`/`Backspace` for image nodes
(`removeImageNode`), widget nodes (`backendTools.delete_widget`) and edges
(`unbindEdge`).

#### Entscheidung 14 — Why React Flow instead of a custom canvas?

- The earlier project used Fabric.js for a fixed-canvas surface. Moving to a
  **canvas-centric, infinite workspace** demanded zoom/pan, multi-selection,
  node-snapping, edge routing — all of which React Flow provides production-
  ready. Reinventing it would dwarf the value-add of the editor itself.
- The **WidgetNode** abstraction maps 1:1 to the AI affordance: an AI-spawned
  widget is *a node on the canvas, tethered to the image it affects*. React
  Flow's selection + key handling slots into this directly.
- Tradeoff acknowledged: React Flow renders nodes as plain DOM, not on a GPU
  canvas. We pay a DOM-layout cost per drag, but every node's *body* is
  `<canvas>` or a styled DOM card — neither suffers from this.

### 5.5 Widgets

Widgets are the unit of AI-composed editing. Three origins, **one backend
call**, three render paths:

```
                  ┌──────────────────────────────┐
"Toolrail click"  ─▶ propose_stack origin=tool_invoked
                  │  → seeds from TOOL_DEFAULTS  │
                  │  → no LLM, no image_context  │
                  └────┬─────────────────────────┘
                       │
"Cmd+K prompt"    ─▶ propose_stack origin=mcp_user_prompt
                       │  → LLM fused tool, requires image_context
                       │
"Autonomous"      ─▶ propose_stack origin=mcp_autonomous
                       │  → LLM fused tool, requires image_context
                       ▼
              add_widget → seed canonical → re-project operation_graph
                       │
                       ├─▶ SSE widget.created → BackendState.widgets
                       │
                       ├─▶ inspector renders panel via ProcessingDefinition
                       │
                       └─▶ for tool_invoked: workspace-tether mints a
                           TetherEdge from active ImageNode → new WidgetNode
                           on the canvas
```

#### Entscheidung 15 — Why "three paths, one call"?

- The SSoT rule. Whether a slider, a prompt, or autonomous suggestion creates
  a widget, the *backend* must mint it, because the backend is the only place
  widget state can live consistently.
- This collapses three potential bug surfaces into one. Validation,
  permission, undo, and SSE-broadcast are written once.
- The `origin` discriminator preserves *attribution*: the WidgetNode header
  shows an "AI" or "·" badge depending on origin.

### 5.6 WidgetShell (`components/widget/WidgetShell.tsx`)

Widgets spawn collapsed (a strip showing variant badge, intent, dirty dot,
scope chip, chevron). Expanding shows reasoning, preview, bindings, and a
footer with **Refine** · **Why?** · **Reset** · **Apply**.

Lifecycle:
- **Slider edit** → optimistic patch on `BackendState`, debounced
  `set_widget_param` after `RUNTIME.sliderDebounceMs` (~300 ms).
- **Apply** → `accept_widget` bakes the widget effect *into* `operation_graph`
  (its canonical params stay; the widget disappears from the canvas).
- **×** → `delete_widget` (effect undone — its canonical contributions cleared).
- **Reset** → reverts every binding to its default.
- **Refine** → inline text input, calls `refine_widget` with the typed
  instruction; LLM produces a new resolution that updates the existing widget
  in place.

The Widget body specialises by type: `HslWidgetBody`, `LevelsWidgetBody`,
`CurvesWidgetBody`, `CompoundWidgetBody`, and a generic `BindingRow` fallback
for unrecognised ops (the registry contract — undefined → fallback, never
throws).

#### Entscheidung 16 — Why "live edit + Apply = bake"?

- Apply must feel like *promotion*, not *commit*. While the widget is open,
  the user is *trying it on*; the live preview is via canonical writes the
  same way an inspector slider would write them. Apply just promotes the
  effect from "associated with this widget" to "part of the permanent stack."
- Dismiss has to actually undo the effect — otherwise users will be confused
  why the image still looks "warm" after they dismissed the warm-grade widget.

### 5.7 Inspector

`InspectorPanel` is the right-rail docked surface. Sections:

- **Adjustments accordion** — for each `LayerType`, list registered
  `ProcessingDefinition`s. Each renders its `Panel` component
  (`LevelsPanel`, `CurvesPanel`, `HslPanel`, `RegistryDrivenSectionBody` for
  registry-driven ops).
- **AI sections** — the same panel surface, but the source is a widget
  (filtered by layer). The same `HslPanelView` renders for both the manual
  HSL panel and the AI HSL widget's body, so the two surfaces share code.
- **Reasoning badges** — small pill (`--radius-sm`, `Sparkles` icon) appears
  on AI-provenance bindings.

`useProcessingParam` is the generic "read this canonical (or widget) param
and write it back" hook, identical signature to `useCanonicalParam`. Both
ultimately delegate to `useParam` in `src/lib/use-param.ts`, which is the
single read/write reducer:

1. **Read precedence:** optimistic patch → widget binding (widget target) →
   `operation_graph` node param → declared default.
2. **Write:** `applyOptimistic` instant; debounced `set_param` /
   `set_widget_param`.
3. **Stale-write guard:** if the optimistic map was cleared by an
   undo/redo/revert *between* keystroke and debounce fire, the scheduled
   write is suppressed.

#### Entscheidung 17 — Why one `useParam` reducer instead of two?

- `set_param` (canonical) and `set_widget_param` (widget binding) differ in
  one of the three steps (the actual backend call). Everything else — keyed
  optimistic write, debouncing, stale-write guard, default fallback — is
  identical. A shared reducer means any latency or guard fix lands once.

### 5.8 Registries on the frontend

- **`ProcessingRegistry`** — registered `ProcessingDefinition`s. Look up
  by id (`light`, `color`, `hsl`, …), by adjustment type (an
  `Adjustment` may map to multiple processing defs — e.g. `basic` →
  `light` + `color`), by category. Defensively soft on misses (returns
  `undefined`/`[]`).
- **`CanvasToolRegistry`** — `ToolDefinition`s for canvas-level tools (select,
  move, …). Filterable by category and editor mode.
- **`LlmToolRegistry`** — generates the LLM-facing tool manifests (REST `POST
  /tools/{name}` shapes). Lives in `src/lib/tool-manifest/`.

The **triple registry** pattern is intentional: one registration affects three
surfaces, but each surface is responsible for its own concerns. Adding `hsl`
to `ProcessingRegistry` makes it appear in the inspector and the WebGL
pipeline; adding it to `LlmToolRegistry` makes it visible to the LLM; the
backend reads `shared/registry/ops/hsl.json` for params and defaults. All
three sources agree because they read the same JSON for the bits they share.

### 5.9 Hooks

Highlights of `src/hooks/`:

- `useBackendSession` — owns the session lifecycle (POST `/session`, open
  SSE, attach phases).
- `useImageNodeRender` — drives the per-image-node composite on a hidden
  canvas. Subscribes to BackendState snapshot + EditorStore layer changes.
- `useLayerWidgets` — returns the widgets the snapshot says belong to the
  active layer (filtered by `widget.nodes[0].layer_id`).
- `useImageContext` — gets `image_context` for the active node, with a
  contract test that ensures it stays in sync with backend shape.
- `useCanonicalParam` / `useProcessingParam` — thin wrappers around
  `useParam` (see 5.7).
- `useAutoTetherAiSuggestions` — when an `mcp_autonomous` widget arrives via
  SSE, mints a tether to the originating ImageNode (a "look at me" affordance
  for the user).
- `useMobileSam` — on-device SAM via `onnxruntime-web`.
- `useChromeMinFloor` / `useChromeVisible` — viewport sizing rules for the
  docked chrome.

### 5.10 Component hierarchy (strict)

The codebase enforces a 3-tier component hierarchy via a custom ESLint rule
(`tools/eslint-rules/no-nested-component-definition.test.js`, wired into
`npm run check` and pre-commit):

1. **Primitives** (`components/ui/`) — atomic, presentational, no app state.
   `Kbd`, `Empty`, `Swatch`, `PercentBar`, `AdjustmentSlider`, etc.
2. **Level-2 / topic folders** (`workspace/`, `inspector/`, `panels/`,
   `toolbar/`, `widget/`) — compose primitives + read stores.
3. **Page scaffolds** (root of `components/`) — `EditorDialog`,
   `PreferencesPage`, `EditorProvider`, `KeyboardShortcuts`.

Hard rules:
- **No inline-defined components.** A component declared inside another
  component body is forbidden; hoist to module scope. (Render callbacks are
  fine.)
- **Reuse before invent.** Primitive search precedes JSX writing.
- **Cross-domain primitives** (used by ≥2 topic folders) move to `ui/`.

#### Entscheidung 18 — Why an ESLint rule for component nesting?

- Inline components are a perfect React footgun: a new identity per parent
  render forces full subtree remount, including state and animations. The
  rule is *cheap* to write and catches the bug before code review can.
- The 3-tier rule is the architectural counterpart: it stops the codebase
  from devolving into a folder soup as the editor grows.

### 5.11 Visual register (`design.md`)

- Aesthetic: **minimal flat Vercel/Radix**. Solid surfaces, 1 px hairline
  borders, no blur, no `backdrop-filter`.
- Light is default; dark via `data-theme="dark"` on `<html>`.
- Tokens live in `src/index.css` under `@theme`. **Never** hardcode hex, px,
  ms, or cubic-bezier values for design quantities — use tokens.
- Two border tokens that must not be confused: `--color-separator` (faint,
  docked dividers, input borders) vs `--color-border-strong` (visible
  perimeter for floating `.overlay` surfaces).
- Motion: opacity + 4 px translate tweens at `--duration-normal` (160 ms)
  with `--ease-apple` (`cubic-bezier(0.2, 0, 0, 1)`). No springs, no
  `layoutId`, no scale-pop.
- Typography: Geist Variable / Geist Mono. Numeric readouts get the `.num`
  utility (Geist Mono + tabular-nums) so digits don't jitter.

#### Entscheidung 19 — Why this register?

- AI affordances must remain **subtle and optional** (a thesis commitment).
  A noisy, scale-popping, gradient-heavy UI works against that.
- Vercel/Radix is the lightest plausibly-modern aesthetic; it keeps the
  image at the centre of the eye and lets content carry the weight.

---

## 6 · Critical sequences (end-to-end)

### 6.1 Slider drag (manual adjustment)

```
User drags slider
   │
   ▼
AdjustmentSlider.onChange → useCanonicalParam.set(v)
   │
   ▼
useParam.set(v):
   - BackendState.applyOptimistic("canon:L:exposure", { exposure: v }, baseRevision)
   - debounced (300 ms): backendTools.set_param({ layerId, op, param, value })
   │
   ▼
BackendState.snapshot now has the optimistic patch → image-node-renderer re-renders instantly
   │
   ▼
[300 ms after last keystroke]
   │
backendTools.set_param → POST /tools/set_param
   │
ToolRegistry.invoke("set_param")
   - validate input
   - resolve session
   - permission gate (requires_image yes; requires_context: tool-dependent)
   - handler writes canonical[L][exposure][value] = v
   - operations.project_to_graph(doc) → new OperationGraph
   - doc.revision += 1
   - EventBus.publish(StateEvent { kind: "state.snapshot", revision, payload: snapshot })
   │
   ▼
SSE → sse-subscriber → BackendState.reconcile(snapshot)
   - replace snapshot
   - drop optimistic patch (revision moved past baseRevision)
   │
   ▼
image-node-renderer reads authoritative snapshot, re-renders (already correct)
```

### 6.2 Open image → analyze → autonomous suggestions

```
User picks file
   │
useFileIO → editorDocument.openImage(file)
   - decode via createImageBitmap
   - register source + working OffscreenCanvas in CanvasRegistry
   - new layer in EditorStore
   │
upload bytes → POST /api/session (create_session if needed) or POST /api/upload
   │
backend stores image_bytes (per image_node) → SSE state.snapshot
   │
useBackendSession opens SSE; subscriber starts phase tracking
   │
analyze pipeline (orchestrated; phases run concurrently after `update`):
   1. update      — mark a new analyze run; reset phase map
   2. mechanical  — fast statistics: histogram, palette, problem heuristics
   3. sam_embed   — SAM 2 image embedding (warm cache for any future click)
   4. ai_context  — Claude vision call: image_context (regions, problems, tags)
   5. mask_precompute — masks for named regions (sky, subject, …)
   6. widget_mint — autonomous_suggestions.mint_autonomous_suggestions:
                    pick fused templates by problem severity, resolve each
                    via run_fused_tool, stamp with layer_id, emit
                    widget.created with origin=mcp_autonomous
   │
each phase emits phase.started / phase.completed; BackendState tracks them
   │
SSE widget.created events flow in
   │
useAutoTetherAiSuggestions reacts: tetherWorkspaceWidget(widget) → mints a
    TetherEdge from the originating ImageNode to a new WidgetNode placed by
    workspace-layout
```

#### Entscheidung 20 — Why split analyze into named phases?

- Each phase has a distinct *user-facing meaning* (so the status bar can read
  "Analysing image…" → "Finding regions…" → "Preparing suggestions…").
- Phases 2–4 are independent; running them in parallel saves a couple of
  seconds. Naming them lets the frontend show a multi-progress UI without
  inventing a bespoke event vocabulary.
- A cancel flow needs to know which phase to interrupt; the names give us a
  natural unit.

### 6.3 Toolrail click ("Light" with no analyze yet)

```
User clicks toolrail Light
   │
toolrail-spawn.ts gates: activeImageNodeId !== null && sseStatus === 'open'
   │
backendTools.propose_stack({
  origin: 'tool_invoked',
  fused_tool_id: 'light',
  layer_id: activeLayer
})
   │
POST /tools/propose_stack
   │
ToolRegistry: requires_image yes; requires_context BYPASSED for tool_invoked
   │
handler: build a Widget from TOOL_DEFAULTS (subset of params declared in the
         registry op as 'tool_defaults'); seed canonical with their defaults;
         project_to_graph; emit widget.created with origin=tool_invoked
   │
SSE widget.created → BackendState.widgets
   │
workspace-tether: place WidgetNode + TetherEdge next to activeImageNode
   │
WidgetShell renders; user starts dragging sliders → 6.1 loop
```

### 6.4 Cmd+K prompt

```
User opens command palette, types "make it warmer"
   │
palette-actions: submit prompt with current image_node + active layer
   │
backendTools.propose_stack({
  origin: 'mcp_user_prompt',
  prompt: 'make it warmer',
  layer_id, image_node_id
})
   │
ToolRegistry: requires_image yes; requires_context yes
   │
handler: LLM call (Claude) with system prompt + image_context (prompt-cached)
   - LLM picks a fused tool (e.g. warm_grade)
   - fused_framework resolves the template's tunable params for THIS image
   - mint widget(s); seed canonical; project_to_graph; emit widget.created
   │
SSE → BackendState → inspector AI section appears AND a WidgetNode is
       tethered onto the canvas
```

#### Entscheidung 21 — Why fused tools are templates, not free-form generation?

- A free-form LLM generation would write directly to `canonical` and could
  pick out-of-range, contradictory or shader-incompatible params. We've seen
  it.
- A template (`NodeSkeleton` + `BindingSkeleton`) declares which params are
  *fixed* and which are *tunable*; the LLM only fills tunable slots and only
  within declared ranges. The result is a *working widget*, the thesis's
  USP: "AI composes a widget the user can keep adjusting from."
- Templates are also *human-readable specs* — the thesis can show one and
  the reader sees exactly what was synthesised.

---

## 7 · Operation graph data model

```
SessionStateSnapshot
  ├─ session_id
  ├─ image_context
  ├─ revision
  ├─ operation_graph
  │    ├─ nodes        OpNode[]
  │    │    ├─ id            (= "canon:<layer>:<op>")
  │    │    ├─ type          (op id; basic, hsl, curves, …)
  │    │    ├─ params        Record<paramKey, value>
  │    │    ├─ layer_id      (single-layer scope)
  │    │    ├─ layer_ids?    (node-scope: applies to composite of these layers)
  │    │    └─ scope         Scope discriminated union (global | mask:click | mask:proposed)
  │    └─ panelBindings  PanelBinding[]  (rendered controls per node, from widgets)
  ├─ widgets[]
  │    ├─ id, intent, origin, fused_tool_id, status
  │    ├─ nodes[]     WidgetNode[]   (each maps to an OpNode via canonical seed)
  │    └─ bindings[]  ControlBinding[]
  │         ├─ paramKey
  │         ├─ control_type   ('slider' | 'toggle' | 'choice' | 'color' | 'region_picker' | 'mask_thumbnail' | 'curve_editor')
  │         ├─ control_schema (typed: min/max/step for sliders, etc.)
  │         ├─ value
  │         ├─ default
  │         └─ target  { node_id, param_key }   ← points back at the OpNode it drives
  └─ masks_index
```

- `OpNode.id` is `canon:<layer>:<op>` so it's stable across edits.
- `Widget.origin` ∈ { `tool_invoked`, `mcp_user_prompt`, `mcp_autonomous`,
  `fused_expansion`, `refine`, `repeat` }.
- `Widget.status` ∈ { `active`, `dismissed`, `accepted` }.
- A binding's `target.node_id` points at a `WidgetNode`; on `add_widget` those
  params seed `canonical`, which in turn projects the matching `OpNode`.
  Editing the binding (via `set_widget_param`) writes back to canonical and
  re-projects. The system has *one* number per (layer, op, param), and three
  ways to refer to it.

---

## 8 · Resilience & invariants

- **Snapshot consistency:** Pydantic with `extra='forbid'` plus `model_validate`
  on every tool input means the document cannot reach an unrepresentable
  state via a bad input. Tool handlers are the only mutating surface.
- **SSE gap recovery:** if `Last-Event-ID` falls outside the retained history
  window, the bus emits `state.gap`; the frontend `fetchSnapshot()`s.
- **Optimistic stale-write guard:** an undo/redo that clears `optimistic`
  cancels any in-flight debounced `set_param`/`set_widget_param` — so a
  delayed write cannot "undo" the revert.
- **Pre-crop original retained:** `CanvasRegistry` stores the pre-crop
  bitmap, so re-entering crop mode shows the whole image; crop is
  non-destructive.
- **Backend disconnect:** the toolrail buttons and Cmd+K are *disabled* when
  `sseStatus !== 'open'`. The doctrine — there's nothing local to write to —
  is enforced at the UI level too.
- **Type drift:** `npm run check` runs `gen:types:check` (regenerates shared
  TypeScript from Pydantic and fails if the working tree changes), `tsc -b`,
  `eslint .`, and `vitest run`. Pre-commit blocks on it.

---

## 9 · Build, run, packaging

- **Dev:** `npm run dev` (Vite) + `npm run dev:backend` (uvicorn). Backend
  defaults to `127.0.0.1:8787`; frontend hits it via
  `VITE_AI_BACKEND_URL`.
- **Type-check + lint + test:** `npm run check`.
- **Production build:** `tsc -b && vite build`. Output lands in `dist/`.
- **Electron desktop:** `npm run electron:dev` / `electron:build`. The
  `electron/main.cjs` wraps the Vite output into a desktop app
  (`com.cloudhaus.photo-editor`).
- **Backend persistence:** `.sessions/<sid>/...` on disk; pruned on
  `RUNTIME.disk_session_max_age_s`.

---

## 10 · Test surface (selected)

- **Pure logic** — `auto-tune.test.ts`, `largest-inset-rect.test.ts`,
  `mask-overlap.test.ts`, `colour-band-spawn.test.ts`, `scope-to-mask.test.ts`,
  `node-to-adjustment.test.ts`, `processing-registry.test.ts`,
  `mechanical-context.test.ts`, `command-palette.test.ts`, etc.
- **Hooks + integration** — `useCanonicalParam.test.tsx`,
  `useLayerWidgets.test.tsx`, `useImageNodeRender.test.tsx`,
  `useWidgetExpansion.test.tsx`, `useImageContext.contract.test.ts` (asserts
  backend shape), `backend-state-slice.test.ts`, `sse-subscriber.test.ts`.
- **Registry** — `engine/registry.test.ts`, shared `interpolate-1d` tests.
- **Backend** — `backend/tests/...` covers tool registry, canonical/ops
  projection, fused-tool resolution paths, SAM client adapters.
- **ESLint custom rule** — `tools/eslint-rules/no-nested-component-definition.test.js`.

---

## 11 · Glossary

- **Canonical** — the per-(layer, op) dict that *is* the source of truth for
  adjustment values.
- **Operation graph** — read-only projection of canonical (plus widget panel
  bindings) sent to the frontend in every snapshot.
- **Snapshot** — the full `SessionStateSnapshot` (image_context, op_graph,
  widgets, masks_index, revision).
- **Widget** — an AI- or tool-spawned, named editing surface with bindings;
  carries provenance via `origin`.
- **Fused tool** — a backend template (deterministic `NodeSkeleton` +
  `BindingSkeleton`) the LLM resolves to a concrete widget for the current
  image.
- **Engine-SSoT** — the doctrine: backend owns every pixel-affecting value.
- **Tether** — a React Flow edge that visually attaches a `WidgetNode` to the
  `ImageNode` it affects. Carries attribution only.
- **Scope** — the spatial domain an adjustment applies to: global, a layer
  mask, a SAM click mask, or a named region.
- **Composite-then-apply** — render layers first, then run node-scope shader
  passes on the *composited* result; overlays paint last.
- **Optimistic patch** — frontend-only pre-acknowledgement of a slider edit
  for instant feedback; dropped when the authoritative snapshot lands.

---

## 12 · What to write *about* in the thesis text

When the second agent uses this brief to write narrative text, the
load-bearing points (in roughly decreasing thesis-relevance order) are:

1. **The Engine-SSoT doctrine and why a stateful backend** (Entscheidungen 1, 2, 3).
2. **The shared JSON registry as a single source of truth for two runtimes**
   (Entscheidung 5).
3. **Three spawn paths, one backend call — the widget abstraction as the unit
   of AI-composed editing** (Entscheidung 15) — this is the thesis's USP.
4. **Fused tools as templates the LLM resolves**, not free-form generation
   (Entscheidung 21).
5. **The Operation Graph as a projection of canonical**, never edited
   directly (Entscheidung 7).
6. **Optimistic patches + SSE reconciliation** — the resilience and latency
   story (Entscheidungen 2, 4).
7. **Per-layer WebGL + 2D composite + composite-then-apply** — the rendering
   story (Entscheidung 12).
8. **React Flow workspace + TetherEdge as attribution** (Entscheidung 14).
9. **The strict component hierarchy + ESLint rule** — code-health story
   (Entscheidung 18).
10. **The visual register's restraint as a deliberate AI-affordance choice**
    (Entscheidung 19).

Use the cross-references freely — every Entscheidung points to a specific
file or pair of files (the modules referenced in §4.1, §5.1, §5.2 and the
data model in §7). The argumentation in each Entscheidung is the rhetorical
spine.
