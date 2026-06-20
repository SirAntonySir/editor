# Backend & Anthropic Strategy — Thesis Handover

> **Purpose.** Source material for the thesis chapters on (a) what the
> backend does, (b) how it talks to Anthropic, and (c) how the cockpit
> turns the system into an evaluable artefact. Every number, every file
> path, every prompt name is real and citable. Sections map roughly to
> the order you'd write the chapter: orientation → endpoints → tools →
> Anthropic strategy → context flow → admin/cockpit → cost story.

---

## 1 · Orientation: what the backend is

A **stateful FastAPI process** on `127.0.0.1:8787`. One service. No
microservices. Three persistent surfaces:

1. **REST API** (`backend/app/api/`) — every editor mutation flows
   through `POST /api/tools/{name}`; auxiliary endpoints for session
   creation, snapshot reads, and a legacy `/analyze`–`/panel`–`/refine`
   triple kept for the original frontend.
2. **SSE stream** (`GET /api/state/{sid}/events`) — server-push channel
   for `state.*`, `widget.*`, `mask.*`, `phase.*`, `mcp.usage`,
   `state.gap`. Replays from `Last-Event-ID` on reconnect.
3. **Disk** (`backend/.sessions/<sid>/`) — per-session directory
   carrying `image.<ext>`, `meta.json`, `context.json`, `state.json`
   (the pickled `SessionDocument`), and `events.jsonl` (the **append-only
   event journal** the cockpit reads).

The backend owns every pixel-affecting value (the Engine-SSoT doctrine
documented in `docs/implementation-architecture-handover.md`). The
frontend is a *viewer + tool client*: it watches SSE, reads the
projected snapshot, and asks the backend to mutate via REST tool calls.

---

## 2 · The REST endpoint surface

Three groups: **session lifecycle**, **state I/O**, and **tool
invocation** (with a few legacy and observability extras).

### 2.1 Session lifecycle (`backend/app/api/session.py`)

| Method · Path | Purpose |
|---|---|
| `POST /api/session` | Upload an image; mint a session id; persist `image.<ext>` + `meta.json`. Returns `{ session_id, mime_type }`. |
| `POST /api/session/{sid}/images` | Add a second/Nth image to an existing session — per-image-node multi-image support. |
| `POST /api/session/{sid}/cancel` | Interrupt the in-flight mutate/emit tool task on this session. Used by the status-bar cancel button while analyze is running. |
| `POST /api/session/{sid}/context` | Backdoor to seed `image_context` from a fixture — kept for integration tests; bypasses Anthropic. |

### 2.2 State I/O (`backend/app/api/state.py`)

| Method · Path | Purpose |
|---|---|
| `GET  /api/state/{sid}` | Return the full `SessionStateSnapshot` (operation graph, widgets, masks index, image context, revision). Wrapped in `with_document_lock` to prevent torn reads. |
| `POST /api/state/{sid}/{undo,redo,revert}` | Backend history surface. Returns `{revision, applied}` or 409 if the stack is empty so the caller can fall back to the frontend's workspace history. |
| `GET  /api/state/{sid}/history` | The history log (entries, cursor, can_undo, can_redo). |
| `POST /api/state/{sid}/jump/{cursor}` | Seek the history cursor directly. |
| `GET  /api/state/{sid}/masks/{mask_id}` | Stream a single mask's PNG bytes (also lock-wrapped). |
| `GET  /api/state/{sid}/events` | **The SSE stream.** Replays from `Last-Event-ID` against `doc.history`; emits a synthetic `state.gap` if the requested id is older than the retention window. |

### 2.3 Tool invocation (`backend/app/api/tools_rest.py`)

A single dispatch endpoint:

```
POST /api/tools/{name}
  body: { session_id, input }
  response: ToolResponseEnvelope { ok, output | error }
```

This is the *only* mutation surface the frontend uses. Every editor
action — opening Cmd+K, dragging a slider, clicking Apply, drawing a
mask — is one or more calls into this route with different `name` and
`input` shapes. Validation, permission gates, rate limiting, and the
session document write-lock are all enforced inside the registry
(`backend/app/tools/registry.py`); the route is a thin shell.

### 2.4 Legacy: `/analyze`, `/panel`, `/refine`, `/name-region`

Predate the tool registry. Still functional, kept so the original
frontend path can be diffed against the MCP-flavoured one during the
thesis evaluation.

- `POST /api/analyze` — runs `anthropic.analyze_image` once,
  optionally followed by SAM refinement, caches the result on the
  session record.
- `POST /api/panel`, `POST /api/refine` — Phase-1 OperationGraph
  generation and refinement. New code goes through `propose_stack` /
  `refine_widget` instead.
- `POST /api/name-region` — labels a SAM-derived mask the user just
  drew. Still used by the Objects-Mode click path.

### 2.5 Segmentation (`backend/app/api/segment.py`)

- `POST /api/segment/embed` — compute the SAM 2 image embedding once
  per session.
- `POST /api/segment/decode` — given click/box prompts, return a mask.

These wrap `services/sam_client.py` (SAM 2.1 or the future SAM 3 stub)
and route through `asyncio.to_thread` because Meta's predictor is
synchronous.

### 2.6 Observability

| Method · Path | Purpose |
|---|---|
| `GET  /health` | Liveness ping. |
| `POST /api/telemetry/{sid}/event` | Frontend → backend UI event sink. Bodies are `{name, props}`. Appended verbatim to the session journal as `telemetry.<name>`. |
| `GET  /admin/*` | The admin cockpit (see §6). Localhost-only by IP gate. |

---

## 3 · How the tool registry works

`backend/app/tools/registry.py` holds a `BackendToolRegistry` —
constructed once at startup, populated by
`register_all_atomic_tools` + `register_all_widget_tools`. Each tool is
a `BackendTool` subclass declaring:

- `name` (string id)
- `kind` (`"query" | "mutate" | "emit"`)
- `input_schema` / `output_schema` (Pydantic)
- `permissions: ToolPermissions(requires_image, requires_context, expose_mcp, expose_rest)`
- `async def handler(self, doc, input) -> output`

The registry's `invoke(name, session_id, raw_input)` does:

1. Look up the tool. Unknown → `unknown_tool` envelope.
2. Validate input via `tool.input_schema.model_validate(raw_input)`.
3. Resolve the session (`SessionStore.get(session_id)`). Bootstrap
   tools like `create_session` skip this.
4. Permission gate: `requires_image` (block until upload),
   `requires_context` (block until `analyze_context` ran). The
   `tool_invoked` widget path **deliberately bypasses
   requires_context** so the toolrail buttons work without an LLM
   first.
5. Acquire the per-session document write-lock so mutations serialise.
6. Run the handler under `set_active_doc(doc)` framing.
7. Wrap typed exceptions (`_UnknownRegion`, `_OrphanBinding`,
   `_MissingContext`, …) into envelope `error.code` strings.

Two tool families are registered.

### 3.1 Atomic tools (`backend/app/tools/atomic/`)

Building blocks. Deterministic where possible.

| Group | Tools |
|---|---|
| **Session** | `create_session`, `prepare_image`, `analyze_context`, `precompute_regions`, `suggest_widgets` |
| **Queries** | `get_image_context`, `list_widgets`, `get_widget`, `list_layers`, `list_named_regions`, `list_fused_tools` |
| **Selection / masks** | `select_by_point`, `select_by_box`, `select_named_region`, `get_active_selection`, `clear_selection`, `propose_mask`, `combine_masks`, `delete_mask`, `rename_mask`, `highlight_region` |
| **Geometry / layers** | `set_image_node_transform`, `apply_adjustment` |
| **AI surfaces** | `smart_match_command` (palette typing-time matcher), `preview_widget`, `add_note` |

Of these, only `analyze_context`, `suggest_widgets`,
`smart_match_command`, and the segmentation tools call Anthropic. The
rest are pure document mutations or queries.

### 3.2 Widget tools (`backend/app/tools/widgets/`)

The user-facing editing vocabulary.

| Tool | What it does | LLM calls |
|---|---|---|
| `propose_stack` | Compose a stack of editing widgets for one user intent. | `plan_widget_stack` + N × `resolve_widget_params` |
| `refine_widget` | Re-tune an existing widget given a refine instruction. | Routes through a fused template's `resolve_fused_tool` |
| `repeat_widget` | Clone a widget at a new scope. | None |
| `accept_widget` | Promote canonical values; remove the widget chrome. | None |
| `delete_widget` | Reverse the widget; clear canonical contributions. | None |
| `restore_widget` | Un-dismiss a widget. | None |
| `set_param` | Slider write on canonical (Adjustments accordion). | None |
| `set_widget_param` | Slider write on a widget binding (canvas card). | None |
| `unlock_widget_param` | Drop a "locked" marker from a binding. | None |

Most widget tools are LLM-free. The cost lives in `propose_stack` and
`refine_widget`.

### 3.3 Fused tools (`backend/app/tools/fused/`)

*Not registered with the tool registry.* These are **template
descriptors** consumed by the LLM. Each declares:

- a **node skeleton** (what shader nodes get minted)
- a **binding skeleton** (what sliders show on the widget)
- a **param envelope** with min / max / step / `skin_safe_max` per knob
- **`context_inputs`** — dotted paths into `EnrichedImageContext` that
  the resolver should ship to the LLM

When `propose_stack` decides "use the warm-grade template", it calls
`run_fused_tool(template, intent, ctx, …)` which builds a focused
context dict (only what `context_inputs` requests), calls
`anthropic.resolve_fused_tool(template_id, prompt_payload, schema)`,
gets back numbers, clamps them to the envelope, and mints a `Widget`.

Templates: `warm_grade`, `cool_grade`, `cast_correct`,
`exposure_balance`, `lift_shadows`, `recover_highlights`,
`teal_orange`, `sky_recovery`, `subject_pop`, `portrait_glow`,
`bw_cinematic`, `bw_variants`, `tone_band`, `colour_theory`,
`atmospheres`, `moods`, `finishing`, `light_surgery`,
`complementary_grade`, `analogous_grade`, and a few more.

Templates are also indexed in `shared/registry/presets/*.json` so the
frontend palette can offer them and the planner can pick by id.

---

## 4 · Anthropic strategy

All Claude calls live in **`backend/app/services/anthropic_client.py`**.
One class (`AnthropicClient`) instantiated once per process by
`api/deps.py`. Two models are configured:

- `anthropic_model` (default `claude-opus-4-7`) — the **quality tier**;
  used for analyze, planner, resolver, refine.
- `anthropic_fast_model` (default `claude-haiku-4-5-20251001`) — the
  **latency tier**; used only by `smart_match` (palette typing-time).

A shared `_messages_create` wrapper retries on transient errors
(connection drop, timeout, rate limit, 5xx) with 0.5 s → 1.0 s
backoff. 4xx errors propagate after logging the response body.

### 4.1 Where prompts live

**All system prompts are module-level constants** at the top of
`anthropic_client.py`. They are not loaded from disk, not jinjafied,
not LLM-generated. The reader sees the exact string Claude sees.

| Constant | Used by | Phase |
|---|---|---|
| `ANALYZE_SYSTEM_PROMPT` | `analyze_image` | Initial vision pass — emit `ImageContext`. |
| `_AUGMENT_PROMPT` | `augment_context_soft_fields` | Second pass — fill `EnrichedImageContext` soft fields (white-point, grade character, problems). |
| `REFINE_CONTEXT_SYSTEM_PROMPT` | `refine_image_context` | After SAM, review the annotated composite and emit `accept` / `drop` / `refine` per region. |
| `NAME_REGION_SYSTEM_PROMPT` | `name_region` | Label one user-drawn mask. |
| `PANEL_SYSTEM_PROMPT` | `generate_panel` *(legacy)* | First-iteration OperationGraph generator. Superseded by planner+resolver pair. |
| `REFINE_SYSTEM_PROMPT` | `generate_refined_panel` *(legacy)* | Refine a panel via natural-language instruction. |
| `_PLANNER_SYSTEM_PROMPT` | `plan_widget_stack` | Compose 1–6 conceptually-grouped widgets from an intent. Outputs JSON. |
| `_RESOLVE_SYSTEM_PROMPT` | `resolve_widget_params` | Tune numeric params for *one* op. **Stable across all N ops in a stack** so the prompt cache hits. |
| `_FUSED_RESOLVE_PROMPT` | `resolve_fused_tool` | Tune numeric params for one fused template. |
| `_FLESH_BINDING_PROMPT` | `flesh_out_binding` | Extend a widget with a new binding. |
| `_SMART_MATCH_PROMPT` | `smart_match` | Rank op/preset ids that fit a typed palette query. |

The **tool schemas** (`emit_image_context`, `emit_operation_graph`,
`emit_context_refinements`, `emit_region_label`,
`emit_context_soft_fields`, `emit_fused_tool_values`,
`emit_chosen_fused_tool`, `emit_smart_match_picks`, `emit_new_binding`)
are also constants in the same module. Their `input_schema` is
either generated from the corresponding Pydantic model
(`Model.model_json_schema()`) or hand-rolled. **`emit_context_soft_fields`
is hand-rolled on purpose** — auto-generated `$defs` refs broke
Claude's tool-use loop (it returned placeholder strings instead of
filled fields); inlining fixed it. That choice is documented as Entscheidung in `docs/problems-and-solutions-handover.md` §7.2.

### 4.2 The Anthropic-facing methods, by purpose

| Method | When fired | Cost tier |
|---|---|---|
| `analyze_image(image_bytes, mime)` | Once per image, on `POST /api/analyze` or the `analyze_context` tool. Identifies subjects + candidate regions. | Opus — heaviest single call (~2k output tokens for `ImageContext`). |
| `augment_context_soft_fields(image, cheap_stats)` | Second analyze pass; fills `EnrichedImageContext` (white-point, grade character, problems). Runs concurrently with mask precompute. | Opus — short output (<200 tokens). |
| `refine_image_context(annotated_image, ctx)` | After SAM produces masks. Claude inspects the colored-outline overlay and emits per-region accept/drop/refine. | Opus — second image pass; not used in the current chip workflow. |
| `name_region(image, mask)` | One label per user-drawn mask in Objects mode. | Opus — tiny (3-6 word label). |
| `suggest_fused_tools_for_character(grade_character, lighting, ...)` | Inside `suggest_widgets`; picks N template ids by character match (no image). | Opus — ~50 tokens output. |
| `resolve_fused_tool(template_id, payload, schema)` | Once per autonomous suggestion and once per refine. Resolves the template's tunable params for this scene. | Opus — ~200 tokens output. |
| `name_pick_fused_tool(intent, candidates)` | When the planner picked a preset and the fused-tool name needs disambiguation. | Opus — null-or-id output. |
| `plan_widget_stack(intent, scope, ctx, …)` | Once per `propose_stack` invocation (Cmd+K or palette pick). Outputs a JSON plan of 1–6 widgets. | Opus — ~800 output. |
| `resolve_widget_params(op, intent, rationale, …)` | **N per stack**, in parallel via `asyncio.gather`. One call per planned op. | Opus — ~50 output each. |
| `flesh_out_binding(widget, request)` | When the user asks to extend a widget with a new control (rare). | Opus. |
| **`smart_match(query, ctx, ops, presets)`** | **Per debounced palette keystroke** (250 ms debounce, ≥4 chars, only when deterministic side is sparse). | **Haiku 4.5** — short output (≤3 picks). |

### 4.3 The flow of one Cmd+K prompt

```
                  user types in palette, ⌘↵
                          │
                          ▼
                propose_stack tool (REST)
                          │
       ┌──────────────────┴───────────────────┐
       ▼                                      ▼
  plan_widget_stack()                  (catalog + ctx
   1 Anthropic call                     are built once
   ~1.5 k in, 800 out                   and reused)
       │
       │  returns plan = [
       │    { widget_name: "Hazy dream", ops: [clarity, blur] },
       │    { widget_name: "Cool grade", ops: [splitTone, hsl] },
       │    …
       │  ]
       ▼
  resolve_widget_params(op=clarity)  ─┐
  resolve_widget_params(op=blur)      │  ALL in parallel via
  resolve_widget_params(op=splitTone) │  asyncio.gather
  resolve_widget_params(op=hsl)       │  ~1.5–2.5 k in each, ~50 out
  …                                   ─┘
       │
       ▼
  add_widget() per resolved op-bundle
       │
       ▼
  SSE widget.created events to frontend
```

Same machinery handles `mcp_user_prompt`, `mcp_autonomous` (from
`suggest_widgets`), and `tool_invoked` (toolrail clicks). The
`tool_invoked` path skips the LLM entirely — it builds widgets from
`TOOL_DEFAULTS` and the user-supplied `forced_ops`.

### 4.4 Where context lives

Three caches with different lifetimes:

1. **`SessionDocument.image_context_by_node[image_node_id]`** — the
   authoritative `EnrichedImageContext`. Written once by
   `analyze_context`, read by *every* downstream LLM call. Survives
   restarts via `session/persistence.py` and reloads on
   `session/revive.py`. Frontend reads it via `GET /api/state/{sid}`.
2. **`SessionRecord.context`** — the legacy `/api/analyze` cache. Same
   shape, different field; kept in sync by `store.set_context`.
3. **`AnthropicClient` system prompts** — module-level constants
   marked `cache_control: ephemeral`. Anthropic caches the prefix
   server-side for ~5 min; subsequent calls in the same window read
   the cache cheaply (10 % of input price).

The **frontend** holds a mirror of `image_context` in
`BackendState.snapshot.imageContext` (from SSE). It's used to render
the Info tab and to populate Cmd+K's attached-context chips. The
frontend never *modifies* the context; only `analyze_context` /
`refine_image_context` write to it.

### 4.5 Prompt-cache discipline

Every system block in `anthropic_client.py` carries
`cache_control: {type: ephemeral}`. The savings only materialise when
two conditions hold:

- The system block has **stable text** across calls. We broke this
  once: `resolve_widget_params` used to append `OP-TYPE: {op.id}` to
  the system text, giving every call a different prefix and zero
  cache hits. Fixed by moving the per-op marker to the user content
  (see §7).
- The cached block is **≥ 1024 tokens** (Opus / Sonnet) or
  **≥ 2048 tokens** (Haiku 3.5). Below that the cache_control
  directive is silently ignored. Our slim image-context blocks are
  ~500–1000 tokens, so the cache often doesn't fire on resolver calls
  — but stripping made the call cheap enough that this is fine.

### 4.6 Context slimming (`backend/app/services/llm_context.py`)

The `EnrichedImageContext` schema is shared between three consumers
with conflicting needs:

- The **frontend Info tab** wants `luma_histogram` (256 ints), per-RGB
  histograms (256 × 3 ints), `region_stats[*].luma_histogram` (32
  ints/region), and the SAM mask PNGs to render thumbnails.
- The **backend renderer** doesn't read the histograms but does need
  the mask PNGs to apply region-scoped adjustments.
- **Claude** can act on the narrative summary (subjects, lighting,
  mood, grade character, problems, region labels with bboxes) and the
  small numeric aggregates (`median_luma`, `contrast_p10_p90`,
  `clipped_*_pct`). It cannot read PNG bytes or 256-bin histograms; it
  can't act on per-pixel polygon coordinates either.

`image_context_for_llm(ctx)` is the pure-function gate at the
backend↔LLM boundary. It drops:

- `mask_png_base64` / `maskPngBase64` (per-region, ~10 KB string each)
- `paths` (per-region, hundreds of `[x,y]` floats)
- `luma_histogram` (top-level, 256 ints)
- `rgb_histograms` (top-level, 768 ints)
- `region_stats` (top-level, per-region 32-bin histograms + stats)

Camel and snake variants of every key are listed (the wire-shape
migration left both forms live). The function is called *once* in
`propose_stack` and threaded through both the planner and the N
parallel resolvers. It is also applied in `smart_match_command` so
typing-time matches are cheap.

The cost impact, measured against the telemetry trace from the
underwater-fish session: **$0.87 → $0.13** per Cmd+K prompt (~7× cheaper)
while producing twice as many widgets. The fix is documented at
length, with the before/after token counts, in
`docs/problems-and-solutions-handover.md` §6.

---

## 5 · The event journal

`backend/app/services/event_journal.py`. Append-only file per session
at `.sessions/{sid}/events.jsonl`. One JSON object per line.

Three classes of writer:

1. **SSE bus mirror.** Every `state.*` / `widget.*` / `mask.*` /
   `phase.*` event published to `EventBus` is also `write_event`'d to
   the journal. This is the bulk of the entries.
2. **Synthetic events** that never round-trip the bus —
   `session.created`, `prompt.entered`, `mcp.usage` — are written
   directly by the producer (the upload route, `propose_stack`,
   `_messages_create`).
3. **Frontend telemetry** — `POST /api/telemetry/{sid}/event` writes
   `telemetry.<name>` entries for UI interactions: Info tab open,
   Compare shift-hold, history dropdown open, panel resizes, …

Design choices:
- **Append-only.** A failed write logs and drops; we never raise into
  the bus or the request handler. The cockpit is research instrumentation;
  it must never break the editor.
- **JSON Lines, not JSON.** Streaming-friendly. `tail -f` during a
  live study works. The reader does not have to hold the whole log in
  memory.
- **Per-session file.** Reads are rare (admin queries); appends are
  hot. Per-session files keep each write bounded; the
  session-prune sweep reclaims them alongside `meta.json`.
- **No schema enforcement** beyond a referenced-session check on the
  telemetry sink. Bad data is research noise, not a security issue —
  the journal is admin-only anyway.

The cockpit derives every metric from these files: cost per session,
acceptance rate, prompt count, token totals, top tools by phase.
Nothing is stored separately. If a derivation rule changes, restart
the cockpit and the historical numbers update.

---

## 6 · The admin cockpit

`backend/app/api/admin.py`. Mounted at `/admin/*`. Single-page HTML
served from a string in the same file (vanilla JS, no build step — so
a column can be added mid-study).

### 6.1 Why it exists

The thesis claim is testable only with **per-session ground truth**:
how often does a user accept the AI's first proposal, how often does
their refine instruction collapse the binding to its default, how
many widgets does the median session generate, what does the median
session cost? Without instrumentation, those questions are
unanswerable. The cockpit is the answer surface.

### 6.2 Localhost-only by IP

`_require_loopback` 403s every request whose peer is not
`127.0.0.1` / `::1` / `localhost`. The module docstring warns
operators not to point a Cloudflare/ngrok tunnel at `/admin` (the
tunnel daemon would appear as the loopback peer and bypass the gate).
The standard pattern is to tunnel `/api/*` + `/health` only.

### 6.3 Endpoints

| Method · Path | Returns |
|---|---|
| `GET /admin` (and `/admin/`) | Single-page HTML cockpit. |
| `GET /admin/sessions?limit&since_ts` | List of one-row summaries newest-first. Each summary derives `event_count`, `widget_proposed`, `widget_applied`, `widget_dismissed`, `prompt_count`, `usd_cost`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `duration_s` from `events.jsonl`. |
| `GET /admin/sessions/{sid}` | Summary + full events list + a live-memory probe (if the record is still resident: image bytes size, has_document, has_context, history length). |
| `GET /admin/sessions/{sid}/image` | Stream the source image bytes — used for inline thumbnails. |
| `GET /admin/aggregate` | Dashboard rollup: total cost, total tokens, total proposed/applied/dismissed, unique users, top phases by frequency. Re-derived every call (cheap at study scale, <10k sessions). |
| `GET /admin/process_stats` | Live memory / disk / process-table info from `services/process_stats.py`. |
| `GET /admin/export.csv` | One CSV row per session, every summary column. Drop into a spreadsheet for the thesis. |
| `GET /admin/sessions/{sid}/export.json` | Single-session full export — summary + every event including their payloads. The JSON file you've been sending me. |

### 6.4 The cost model

```python
_PRICES_USD_PER_M = {
    "claude-opus-4-7":   {"in": 15.00, "cache_write": 18.75, "cache_read": 1.50, "out": 75.00},
    "claude-sonnet-4-6": {"in":  3.00, "cache_write":  3.75, "cache_read": 0.30, "out": 15.00},
    "claude-haiku-4-5":  {"in":  0.80, "cache_write":  1.00, "cache_read": 0.08, "out":  4.00},
    "default":           {"in":  3.00, "cache_write":  3.75, "cache_read": 0.30, "out": 15.00},
}
```

Per Anthropic's published prices at the time of writing. The cockpit
multiplies `mcp.usage.input_tokens × in + cache_create × cache_write +
cache_read × cache_read + output_tokens × out`, divided by 1 M, summed
across every `mcp.usage` event in the session. Model id is captured
from the payload; the cockpit handles `claude-opus-4-7[1m]` (bracketed
suffix variants) by stripping the bracket before lookup.

The constants will drift; the docstring is explicit that this is **not
billing**, it's a research tool. The Anthropic console remains the
source of truth for actual spend.

---

## 7 · The cost story — what we learned

The cockpit was the lens; the telemetry it produced exposed a
~$0.85-per-prompt regression. Walking through it because it's the
cleanest worked example of the cockpit-→-fix loop:

**Observation** (one export JSON for one Cmd+K session, "make it a
dreamy underwater world"):
- `usd_cost`: $0.87
- `input_tokens`: 263,970
- Per-call: every `resolve_widget_params/*` shipped ~32,000 input
  tokens; `cache_read = 0` everywhere.

**Diagnosis** (reading `propose_stack.py` and `anthropic_client.py`):
- `image_context = ctx.model_dump(...)` carried `mask_png_base64` (~10
  KB base64 per region × 3 regions ≈ 22k tokens), `paths` (polygon
  floats ≈ 5k tokens), and 256-bin histograms (~2k tokens). Of every
  32k-token resolver call, **~28k tokens were unreadable by an LLM.**
- `resolve_widget_params`'s system prompt was
  `_RESOLVE_SYSTEM_PROMPT + f"\n\nOP-TYPE: {op.id}"`. Different per
  op = different cache prefix = zero cache reads across the 7 parallel
  resolvers.

**Fix** (`backend/app/services/llm_context.py` + `propose_stack.py`
+ `smart_match_command.py` + `anthropic_client.py:resolve_widget_params`):
1. Strip heavy fields via `image_context_for_llm`. Apply at every
   LLM-bound site.
2. Move `OP-TYPE:` into user content; cache the image-context block
   with `cache_control: ephemeral`. System prompt now stable across
   resolvers.

**Result** (cockpit export of the next dreamy-world prompt):
- `usd_cost`: **$0.13** (was $0.87)
- `input_tokens`: 16,600 (was 263,970)
- Per-call: resolver calls now 1.5–2.5k input each.
- `widget_proposed`: 6 (was 3) — twice as many widgets for one-seventh
  the spend.

**Cache reads** still didn't fire — the slim image-context block is
under the 1024-token cache minimum. The right tradeoff: small
uncached calls beat big cached ones. The fix is committed in
`backend/app/services/llm_context.py` with 11 unit tests + 1 integration
test pinning the strip behaviour.

---

## 8 · Suggested chapter outline for the thesis

A natural order, mapped to the section numbers above:

1. **§7.1 — The backend in one paragraph.** §1 of this document
   collapses to four sentences: stateful FastAPI, REST + SSE + disk,
   Engine-SSoT, frontend is a viewer.

2. **§7.2 — Endpoints.** §2 of this document. Tables of routes
   grouped by lifecycle / state / tools / legacy / observability.
   Mention that `POST /api/tools/{name}` is the *single* mutation
   surface and why (validation, permissions, rate limiting,
   document write-lock all happen there).

3. **§7.3 — The tool registry and the three tool families.** §3.
   Cite the atomic / widget / fused split. Make the point that fused
   templates are *not registered* as tools — they're descriptors the
   LLM consumes. The widget abstraction is the unit of AI-composed
   editing.

4. **§7.4 — The Anthropic strategy.** §4. Two models (Opus for
   quality, Haiku for typing-time). Prompts are constants, not
   templates. The 11 named methods table. The Cmd+K flow diagram.

5. **§7.5 — Where context lives.** §4.4. Three caches, three
   lifetimes. The slimming gate at the LLM boundary.

6. **§7.6 — The event journal.** §5. JSONL, append-only, three
   classes of writer, the cockpit derives from it.

7. **§7.7 — The admin cockpit.** §6. Why instrumentation is needed
   for the thesis. Localhost-only by IP. The pricing model is
   illustrative, not billing.

8. **§7.8 — Worked example: the $0.85 regression.** §7. Observation
   from the cockpit → diagnosis in code → fix → cockpit-confirmed
   result. The cockpit-as-microscope story is what motivated building
   the journal in the first place.

---

## 9 · Citable artefacts

For the bibliography / appendix:

- **Code paths** (all relative to repo root):
  - `backend/app/services/anthropic_client.py` — every Claude call lives here.
  - `backend/app/services/llm_context.py` — the strip helper.
  - `backend/app/tools/widgets/propose_stack.py` — the planner+resolver orchestrator.
  - `backend/app/tools/registry.py` — the tool dispatch surface.
  - `backend/app/tools/fused/*.py` — the template library.
  - `backend/app/api/admin.py` — the cockpit.
  - `backend/app/services/event_journal.py` — the journal writer.
  - `backend/app/api/telemetry.py` — frontend → journal sink.
- **Telemetry exports** (the cockpit's
  `GET /admin/sessions/{sid}/export.json`) — drop the before/after
  JSON into an appendix to substantiate the $0.85 → $0.13 claim. The
  per-call token-count tables in §7 are reproducible from those
  files.
- **Companion handover docs** (sibling files in `docs/`):
  - `implementation-architecture-handover.md` — the Engine-SSoT
    doctrine and the rest of the system around the parts described
    here.
  - `problems-and-solutions-handover.md` — the failure catalog,
    including the cost regression as one of ten.
  - `design-ux-handover.md` — the UX side; the admin cockpit is the
    deliberate violation of the "subtle and optional AI" rule (it's
    for the researcher, not the user).
