# Problems Discovered & Solutions Found — A Git-History Deep Dive

> **Purpose.** Third companion to the two architecture/UX handover briefs.
> This file inventories the real *bugs* the project hit on the way to its
> current state and the *solutions* that closed them. Every entry cites the
> exact commit SHA (clickable in the git log) so the second agent can write
> with primary-source authority. The bias is depth over breadth — fewer
> entries, each one explained with the failure mode and the rationale of the
> chosen fix.
>
> Sources mined: `git log --oneline` across 1,010 commits on this branch
> (mostly between 2026-03-05 and 2026-06-17), the consolidated audit
> `docs/audit-2026-06-15.md` (~165 findings: 14 Critical, 26 High, 49
> Medium, 76 Low), and the design specs under `docs/superpowers/specs/`.

---

## 0 · How to read this brief

Entries are organised by **family of problem** rather than chronologically.
Each entry follows the same skeleton:

- **What broke** — the user-visible symptom or the failure mode.
- **Root cause** — the underlying mechanism, in technical detail.
- **Fix** — what was actually changed and why that approach was chosen.
- **Commit(s)** — short SHA + date + headline.
- **Lessons** (occasionally) — what this taught the codebase as a class
  invariant.

Themes are cross-referenced where relevant; many of the same kinds of bugs
recur in different surfaces (race, drift, double-source-of-truth) and the
pattern matters more than any single occurrence.

---

## 1 · Concurrency & locking

These are the single most-represented family. The backend mixes a sync
threading-Lock-protected `SessionDocument` with async FastAPI handlers and
SSE; the frontend mixes async backend calls with React-paced sliders and
optimistic patches. Where the two meet, races happened.

### 1.1 SSE EventBus had unbounded queues + leaked queues on hard disconnect

- **What broke.** Long sessions or chatty publish paths grew memory without
  bound; `put_nowait` never backpressured. When a client died ungracefully
  (kill -9, network blip), the queue reference leaked in
  `_queues[session_id]` and never freed.
- **Root cause.** `backend/app/state/events.py:20` constructed
  `asyncio.Queue()` with **no `maxsize`**; `backend/app/api/state.py` only
  cleaned up the queue if the async generator was GC'd, which is not
  guaranteed.
- **Fix.** Hard cap `maxsize=1000`. On `QueueFull`, drain the queue and
  inject a synthetic `state.gap` event; the frontend's gap handler refetches
  the full snapshot. Empty subscriber buckets pruned on unsubscribe.
- **Commit.** `83a3668` (2026-06-15) — "fix(backend): stability cluster".
- **Lesson.** The browser's `EventSource` resilience (auto-reconnect with
  `Last-Event-ID`) and the backend's `state.gap` event together form a
  *recovery contract*. The queue cap is what enforces it server-side.

### 1.2 Synchronous Anthropic call on the asyncio event loop

- **What broke.** During an analyze, every SSE feed froze for 30–120
  seconds; tool calls hung; health checks timed out. The whole event loop
  was wedged.
- **Root cause.** `backend/app/api/analyze.py:386` called
  `client.analyze_image()` (sync; the Anthropic SDK is blocking) directly
  from an async handler. Same pattern in `services/sam_client.py:42-46`
  where the SAM model load (multi-GB) ran sync inside an async first-use
  handler.
- **Fix.** Route every blocking SDK call through `asyncio.to_thread`. A new
  `AnthropicClient._messages_create` helper wraps every Anthropic call with
  retry-on-{APIConnectionError, APITimeoutError, RateLimitError, 5xx
  APIStatusError} using 0.5 s → 1.0 s backoff, and preserves the original
  cause via `raise ... from`.
- **Commit.** `83a3668` (2026-06-15).
- **Lesson.** "Async handler + sync SDK" is a class of bug, not a one-off.
  Every external SDK call in a FastAPI handler now routes through
  `to_thread`.

### 1.3 SAM client init race — torch JIT crash with no CORS headers

- **What broke.** Two endpoints fire on session creation — `/api/tools/analyze_image`
  (MCP path) and `/api/analyze` (legacy). FastAPI dispatches each into its
  own threadpool worker. The second worker crashed with
  `KeyError('__torch__.torch.nn.functional.interpolate')`. The 500 escaped
  before CORS middleware, so the *frontend* saw a misleading
  "No 'Access-Control-Allow-Origin' header" error.
- **Root cause.** Both threads checked the unsynchronised
  `_sam_client is None`, both proceeded to construct `SamClient`, and the
  internal `torch.jit.script(SAM2Transforms)` cannot be invoked
  concurrently on the same module class.
- **Fix.** `threading.Lock` + double-checked init. First request acquires
  the lock and loads SAM; later requests await it and return the cached
  singleton. Same pattern applied to `BackendToolRegistry` (also lazy, also
  hit by concurrent FastAPI workers).
- **Commit.** `cee1daf` (2026-05-28) — "fix(sam): lock SamClient init to
  prevent torch JIT race".
- **Lesson.** When two valid entry points share lazy global state, you need
  a lock — not just "a singleton". This is also why the misleading error
  message: backend exceptions that fire pre-CORS show up as CORS errors at
  the browser. A red herring to be aware of.

### 1.4 Backend write-lock deadlock from "parallel" precompute + suggest

- **What broke.** The backend's per-session `with_document_lock` (a sync
  `threading.Lock`) is acquired from inside async tool handlers. After
  firing `precompute_regions + suggest_widgets` as parallel `asyncio.gather`
  tasks, the second tool call hit `lock.acquire()` from the event-loop
  thread *while the first was awaiting work in the thread pool*. Classic
  sync-lock-inside-async deadlock. The lock was never released; any
  further mutate tool (including slider `set_param` writes) hung forever.
- **Root cause.** A sync mutex acquired across an `await` boundary in two
  fire-and-forget tasks racing on the same session.
- **Fix.** Serialise the chain: `precompute_regions` first, then
  `suggest_widgets`. Lock now held by at most one tool at a time. A TODO
  notes that the proper resolution is to convert
  `SessionStore.with_document_lock` to `asyncio.Lock` so concurrent tools
  on the same session yield instead of blocking the loop.
- **Commit.** `664b1d0` (2026-06-11) — "fix(analyze): serialize precompute +
  suggest to avoid backend write_lock deadlock".
- **Lesson.** "It's a threading.Lock" + "we're in async" + "two tasks on
  the same session" is the deadlock recipe. The lock type and the
  concurrency model have to agree.

### 1.5 Torn reads of SessionDocument via /state/{sid} + SSE replay

- **What broke.** A snapshot fetched via `GET /state/{sid}` could return a
  half-mutated document if a tool was concurrently writing. Same for the
  SSE handshake's initial replay-from-history: the replay capture happened
  outside the write lock, so a tool firing between subscribe and replay
  could split events across the boundary.
- **Root cause.** `state.py:60-66` and `:176-198` skipped
  `with_document_lock`; the comment claimed otherwise. Audit findings C9.
- **Fix.** Wrap snapshot computation **and** SSE replay capture **and**
  `get_mask_bytes` in the document write lock. Regression tests assert
  lock acquisition.
- **Commit.** `09f935d` (2026-06-15) — "fix(api/state): hold document
  write-lock around snapshot + replay + mask reads".

### 1.6 Slider drag → stale set_param fires after Revert

- **What broke.** User drags a slider, hits Revert-all, sees the image
  clear, then *watches the adjustment come back*. Revert appeared to "not
  work" — actually it did, but raced.
- **Root cause.** The slider's debounced `setTimeout` (300 ms) was firing
  *after* the backend revert had landed. The stale `set_param` pushed a
  new history entry and effectively undid the revert.
- **Fix.** A **stale-write guard** in `useCanonicalParam`/`useParam`:
  before dispatching the debounced `set_param`, the setTimeout callback
  re-checks that its intended value still sits in `s.optimistic` for this
  `(nodeId, paramKey)`. The `history.applied` handler clears
  `s.optimistic` when it lands; if the value isn't there anymore,
  something newer happened — skip the dispatch.
- **Commit.** `52e0e73` (2026-06-12) — same commit also bundles the
  history-coalescing fix (see 5.1) because the two were entangled.
- **Lesson.** Optimistic patches + debounced backend writes form a
  pipeline; every stage needs a *current-version-check* before it commits.

### 1.7 Cross-store mutation hazards inside the SSE event handler

- **What broke.** `applyEvent` (the SSE event reducer) made cross-store
  calls (`useEditorStore.getState().consumePinRequest()`,
  `tetherWorkspaceWidget()`, `useSuggestionsUi.markPending`) *inside the
  Immer producer*. If either store reset mid-event, state diverged. A
  related case: the `state.gap` handler captured `sid` and fired a
  fire-and-forget `fetchSnapshot()` — without re-checking that the
  session was still active, a late refetch could write into a fresh
  session.
- **Fix (cluster).** Two structural changes:
  1. **Session re-check.** The `state.gap` closure now re-checks
     `useBackendState.getState().sessionId === sid` before writing; logs
     and drops on mismatch.
  2. **Side-effects queue.** `applyEvent` no longer fires cross-store
     calls from inside the Immer producer. Effects (cross-store
     mutations, tether creation, suggestion bridges) are pushed into a
     local array inside the producer, drained *after* `set(...)`
     returns.
- **Commit.** `8d92942` (2026-06-15) — "refactor(backend-state): defer
  cross-store mutations + guard state.gap session".
- **Lesson.** Immer producers are atomic on *one* store; cross-store
  writes inside them break atomicity. The side-effects-queue pattern is
  now the doctrine for this slice.

### 1.8 React's "infinite loop" + setState-in-effect cluster

Frontend rendering produced two classes of crash; both surfaced as
"Maximum update depth exceeded".

- **Object-identity selectors.** Selectors that returned a fresh object
  literal (`s.snapshot?.widgets ?? []`, or a destructured `cropRect`
  object) on every Zustand call were treated as state changes by
  `Object.is`, causing infinite re-renders.
  - **Fix.** Hoist `EMPTY_WIDGETS`/`EMPTY_MASKS` to module scope and use
    those constants as fallbacks. Split composite selectors into
    primitive ones (`cropRect → four scalar selectors + JS derivation`).
  - **Commits.** `a5f144b` (2026-05-30) — `EMPTY_WIDGETS`; `a7733d1`
    (2026-06-03) — cropRect split; `f85c863` (2026-05-15) — palette
    context object stable.
- **setState-in-effect (and setState-in-render).** Seven sites called
  `setState` inside `useEffect` bodies. Each was replaced with the
  canonical equivalent: derived `useMemo` (cheap pure work), previous-prop
  tracking (synchronous reset on prop change), lazy `useState`
  initialization, or moving the `setState` into the subscriber callback
  the effect attaches.
  - **Commit.** `c4c5459` (2026-06-10) — "fix(react): set-state-in-effect
    refactor + DOMMatrix polyfill".

### 1.9 Debounce-ref cleanup missing in 4 hooks

- **What broke.** Slider drag → close panel mid-drag → `set_widget_param`
  fired against a dead session.
- **Fix.** All four debounced param hooks now cancel their pending
  `setTimeout` in `useEffect(() => () => clearTimeout(...), [])`. Three of
  the four hooks were later collapsed into a single `useParam` reducer
  (see 4.1).
- **Commit.** `977bedc` (2026-06-15).

---

## 2 · State persistence & disk hygiene

### 2.1 Sessions on disk never pruned

- **What broke.** `.sessions/<sid>/...` directories accumulated forever,
  some up to 2 MB each (image bytes). A long-running backend would
  eventually fill the disk.
- **Root cause.** `services/session_store.py:195-201` defined
  `prune_disk()` but it was **never called anywhere**.
- **Fix.** `main.py` lifespan now runs `prune_disk()` every
  `disk_prune_interval_s` (default 1 h) for entries older than
  `disk_session_max_age_s` (default 7 d). The same loop also prunes the
  in-memory `SessionStore.records` (which holds source image bytes).
- **Commit.** `83a3668` (2026-06-15); rename to "session pruning" with
  unified memory + disk eviction in `f98aa26` (2026-06-16).

### 2.2 Persistence wrote per-node image data into every checkpoint

- **What broke.** Multi-image-node sessions ballooned the persisted JSON
  by megabytes per checkpoint. Disk fills fast and write latency spikes.
- **Root cause.** `_EXCLUDE_FROM_PERSIST` in `persistence.py` excluded the
  *singleton* `image_bytes`/`prepare_result` but **not** the per-node
  variants (`image_bytes_by_node`, `mime_type_by_node`,
  `prepare_result_by_node`).
- **Fix.** Extend `_EXCLUDE_FROM_PERSIST` to cover the per-node variants;
  document the regen-on-demand contract in module docstrings.
- **Commit.** `e208889` (2026-06-15) + the per-node migration cluster.

### 2.3 Undo silently dropped per-node image context

- **What broke.** Undo on a multi-image-node session wiped the AI's
  `image_context` for every node — the analysis had to re-run.
- **Root cause.** `Snapshot.capture()` predated the per-node refactor and
  did not capture `image_context_by_node` / `prepare_result_by_node`.
  `apply_snapshot` restored canonical/widgets/masks but ignored those
  same fields.
- **Fix.** `Snapshot` carries `image_context_by_node`; `apply_snapshot`
  restores it and clears the legacy singleton. `history.applied` payload
  extended with `imageContextByNode`.
- **Commit.** Per-node migration cluster, landed `c320538..ae701bc` and
  documented in the audit as C3.

### 2.4 Canvas workspace graph not persisted — reload collapsed every layer

- **What broke.** Reloading a multi-image-node session collapsed every
  layer onto a single auto-created image node on the canvas; the layers
  rendered grey.
- **Root cause.** The write-through subscriber only persisted
  `layers + meta`. The workspace graph (`imageNodes`, `widgetNodes`,
  `tetherEdges`, `infoNodes`, `activeImageNodeId`, `imageNodeMode`) was
  never written. On reload, `useBackendSession` only restored the same
  narrow slice; the `CanvasWorkspace` auto-create effect saw an empty
  `imageNodes` plus a populated `layers[]` and minted *one* image node
  containing all layers.
- **Fix.** `PersistedEditorState` gains the six workspace fields.
  `snapshot()` captures them; `changed()` diffs them so updates write
  through. `useBackendSession`'s reattach restores all six in the same
  `setState` call as `layers/meta` — no flash, no race.
- **Commit.** `4b5105e` (2026-06-16).
- **Lesson.** The "grey layers" were a *downstream* symptom of a wrong
  source dimension being fed into the WebGL pipeline. Tracing from the
  visible bug (grey pixels) to the actual cause (missing workspace state
  in persistence) required walking the whole render path.

### 2.5 IndexedDB resilience

Two smaller fixes worth noting:

- Bitmap close on persistence error + skip layers with null 2d context —
  `f074ab4` (2026-05-29).
- Retry `openDb` on transient failure; drop redundant null coalesce —
  `b11ffbf` (2026-05-29).

---

## 3 · The wire shape — snake_case ↔ camelCase migration

This was a multi-week, multi-commit, all-touching problem. The frontend
spoke camelCase; the backend (Pydantic) spoke snake_case; everywhere the
two met, **silent drops** of unknown keys made bugs look like business
logic failures.

### 3.1 The symptom

Sliders didn't move the image. Widget accept/delete/restore silently
no-op'd. The frontend threw "Cannot read properties of undefined (reading
'nodes')" in `ImageNode.tsx` and ~22 other files. Layers panel crashed
when it received `ai-panel` layers with a missing icon entry.

### 3.2 The root cause

Pydantic, configured with `extra='ignore'` (the default), silently
discarded any unknown key. The frontend sent `{widgetId, paramKey,
layerId}` to handlers that expected `{widget_id, param_key, layer_id}`.
Required snake-case fields then failed validation, but the *useful* error
("you sent the wrong case") never reached the developer — only "Field
required" did.

### 3.3 The fix — a sweep across both runtimes

In order:

1. `91364f2` (2026-06-11) — **emit camelCase on the wire via Pydantic alias
   generator.** A new `app/schemas/_camel.py` helper sets
   `alias_generator + populate_by_name=True` on every wire model
   (`ImageContext`, `EnrichedImageContext`, `OperationGraph`, `Widget`,
   `SessionStateSnapshot`, all sub-models). Every `model_dump(mode="json")`
   gains `by_alias=True`. FastAPI endpoints gain
   `response_model_by_alias=True`. Snake-case attribute access on the
   Python side is unchanged.
2. `7f12013` (2026-06-11) — **frontend reads camelCase top-level snapshot
   fields** (`operationGraph`, `masksIndex`, `imageContext`, `sessionId`).
3. `ee03830` (2026-06-11) — **camel_config on registry schemas** so
   `paramKey`/`controlType` from JSON deserialise correctly.
4. `a61946b` (2026-06-11) — **frontend widget tree camelCase sweep** —
   types, accessors, tool-call bodies all migrated.
5. `8ef1f7b` (2026-06-11) — **camel_config on tool `_Input` schemas** with
   `extra='forbid' + populate_by_name=True`. The decisive fix: unknown
   keys now *fail loudly* instead of silently dropping.
6. `55b3f32` (2026-06-11) — **widget event payload camelCase**; drop
   redundant `mask.proposed` emit.
7. `25e4196` (2026-06-11) — **error envelope + segment + name-region**
   camelCase gaps closed.
8. `1e07785` (2026-06-11) — **camelCase SSE delta keys** to close the
   Phase 1 wire-shape gap.
9. `d90e841` (2026-06-11) — **single camelCase `ImageContext`** on the
   frontend; drop the `EnrichedImageContext` mirror that had been kept
   for back-compat.

### 3.4 Why it took nine commits

Migrating *one* model and breaking 22 consumers was a poor tradeoff.
Migrating *all* wire models in lockstep — backend emit + frontend read +
tool input + SSE deltas + error envelopes — meant every commit could be
verified in the browser. The discipline was: any model that crosses the
wire emits and accepts camelCase, with **`extra='forbid'`** on inputs so
the next case-mismatch bug crashes loudly instead of silently dropping.

### 3.5 Lesson

`Pydantic` defaults to `extra='ignore'`. For any wire shape that
encounters two runtimes, this is **the wrong default**: it converts type
bugs into silent data loss. Every project that mixes a JS frontend with a
Python backend will hit this exact bug at least once.

---

## 4 · Source-of-truth drift (the SSoT family)

These are bugs where the same value lived in two places and the two
places disagreed.

### 4.1 Four debounced param hooks doing the same thing slightly differently

- **What it was.** `useCanonicalParam`, `useProcessingParam`,
  `useGraphAdjustmentParam`, `useAdjustmentParam` all had the same shape
  (derive node id → read optimistic → read widgets → read op-graph →
  debounce write), with subtle differences in which step they got
  *slightly* wrong. Some lacked the stale-write guard. Some lacked the
  unmount cleanup.
- **Fix.** Two of the four were dead code and were deleted (`7ee9651`).
  The other two became thin wrappers over a single `src/lib/use-param.ts`
  reducer — debounce, optimistic, stale-write-guard logic lives in one
  file. `bde4617`, `8616011`, `c520261` (2026-06-15).
- **Lesson.** When four hooks have the same shape and differ in *which
  bug they have*, dedup is the fix. Audit H20.

### 4.2 17 fused-tool files had the same skeleton

- **What it was.** `backend/app/tools/fused/*.py` each defined a
  `_RESPONSE_SCHEMA` and an identical `resolve()` calling
  `anthropic.resolve_fused_tool`. ~370 lines of duplicated boilerplate.
- **Fix.** Research found only 9 of 17 actually had the override — the
  base `FusedToolTemplate.resolve()` already auto-generated the same
  `_RESPONSE_SCHEMA` from `param_envelope.keys()`. Extended the base with
  dotted-path `context_inputs` support (`3994691`); deleted 7 overrides;
  2 files kept their overrides as legitimate special cases
  (`sky_recovery` filters region_stats by `is_sky_likely`; `portrait_glow`
  renames the container to `skin_regions`).
- **Commits.** `8afc421`, `fc88cc8`, `ef48d68`, `073a0dc`, `d89949d`,
  `448ba32`, `15382ff`. Audit H21.

### 4.3 Two registries with overlapping op metadata

- **What it was.** `backend/app/registry/loader.py` (the SSoT), plus
  `backend/app/engine/registry.py` (`ENGINE_OPS`), plus
  `backend/app/tools/tool_defaults.py`. Three places to update when an op
  changed. `TOOL_DEFAULTS` had been acknowledged-debt for some time.
- **Fix.** `tool_defaults.py` deleted (`21db7d5`); the lone `filter` entry
  moved inline into `propose_stack._handle_filter_spawn` (`897ef86`).
  `effective_tool_defaults` + `param_label` accessor helpers promoted into
  `registry/loader.py` (`7e225ce`). `backend/app/engine/` deleted entirely
  (`527c2b2`). The audit's two-registries overlap is closed; the single
  SSoT is `shared/registry/ops/*.json`.

### 4.4 Two entry points to widget spawning

- **What it was.** `propose_widget.py` (old fast-path for `tool_invoked`
  LUT/filter) coexisted with `propose_stack._handle_tool_invoked()` doing
  nearly the same work.
- **Fix.** `propose_widget.py` deleted (`21db7d5`); the LUT/filter spawn
  moved to `propose_stack._handle_filter_spawn` (`897ef86`); the one
  frontend caller (`src/tools/filters-tool.tsx`) migrated to
  `propose_stack(forced_ops: ['filter'])` (`f843b1c`). One entry point.

### 4.5 Two acceptance paths for AI widgets

- **What it was.** The SSE `widget.accepted` handler *removed* the widget
  from the snapshot; the frontend `addAcceptedSuggestion` *kept it*.
  Double-render risk.
- **Fix.** The SSE handler's `acceptedSuggestions.add(id)` was always
  redundant — by the time backend confirms acceptance, the frontend has
  already added the widget via either user click or auto-tether. Dropped
  that line; the SSE handler now only filters the widget out of the
  snapshot. The two "paths" collapse into one: frontend marks
  engagement, backend confirms via snapshot mutation. Audit H4.

### 4.6 Four session surfaces with overlapping responsibilities

- **What it was.** `api/session.py`, `mcp/session.py`,
  `services/session_store.py`, `tools/atomic/create_session.py` — four
  files, unclear SSoT for session identity.
- **Fix.** Investigation showed the overlap was narrower than the audit
  framing — `session_store.py` is uncontested SSoT; `mcp/session.py` is
  wire-layer pairing, not lifecycle. The two genuine create paths (REST
  `POST /api/session` and MCP `create_session` tool) diverged on payload
  validation: MCP bypassed both `max_image_bytes` and the `image/*`
  MIME guard. New `services/image_validation.py` centralises the check;
  both paths consume it. Module-level docstrings added to all four files
  documenting the responsibility split. Regression tests: MCP path
  rejects non-image MIME (415) and oversize payloads (413) like REST.
- **Commit.** `d6a197c` (2026-06-15).

### 4.7 Singleton vs per-node image-context migration was half-done

- **What it was.** `document.py` had both `image_context` (singleton) and
  `image_context_by_node`. Both code paths still in use, no sync. Last
  writer wins; persistence only saw one side.
- **Fix.** Writers all per-node-only; `_promote_singletons_to_per_node()`
  runs on every revive **and** every fresh `_new_document`. Doctrine
  documented in four module docstrings. Round-trip + promotion test
  suite. Audit H9.

### 4.8 Widget vs op-graph divergence on orphan bindings

- **What it was.** `set_widget_param` silently skipped the canonical
  write when `node` was None (the binding existed but its target node
  had been deleted). Widget's binding `value` moved; op-graph node
  didn't; UI looked wrong.
- **Fix.** Raise `_OrphanBinding` *before* any state mutation; map to a
  new `orphan_binding` error envelope code so the frontend can surface a
  useful error rather than a silent divergence. Tests cover (a) the
  raise, (b) the state-invariant that no mutation occurs on the orphan
  path, (c) the happy path.
- **Commit.** `2744956` (2026-06-15).
- **Lesson.** Silent skips on inconsistent state are *worse* than crashes
  — the system keeps going in an inconsistent state. Loud errors are the
  invariant.

### 4.9 op_id missing on WidgetNode — Light vs Color confusion

- **What it was.** `sliceWidgetByOp` and `opsForWidget` silently
  mis-labelled `light` nodes as `color` because both share `node_type:
  "basic"` (the shader). The id of the *registry op* is needed to
  disambiguate.
- **Fix.** Add `op_id` to `WidgetNode` (backend Pydantic + frontend TS).
  Frontend identifies the registry op by `op_id`, not `node_type` alone.
  Back-compat fallback (lookup by `node_type`) preserved for pre-existing
  persisted widgets.
- **Commit.** `28cfd69` (2026-06-08).
- **Lesson.** When two distinct domain concepts share a key (`light` and
  `color` both shader `basic`), one of them is going to drive a bug.
  Carry the discriminator everywhere it's needed.

### 4.10 Frontend UI state lived in the backend-mirror slice

- **What it was.** `BackendState` (the snapshot mirror) carried
  `pendingSuggestionIds`, `previewingSuggestionIds`, `acceptedSuggestions`
  — purely frontend UI state. Doctrine breach: the mirror slice should
  only hold what came from the backend.
- **Fix.** Move them into a new `useSuggestionsUi` slice. The SSE
  `widget.created` handler still bridges into `useSuggestionsUi.markPending`
  for autonomous-origin widgets, but as a deferred side-effect (see 1.7).
- **Commits.** `ae47ba2`, `1937007` (2026-06-15).

---

## 5 · Undo / history pipeline

### 5.1 Every debounced set_param became its own undo entry

- **What broke.** A slow slider drag (pausing past the 300 ms debounce
  window mid-drag) stacked dozens of one-tick history entries. Undoing
  the drag took dozens of clicks.
- **Fix.** Backend history coalescing. `HistoryEntry` gains an optional
  `coalesce_key`. `HistoryEngine.push` merges into the tip entry when the
  next push shares the key AND fires within
  `RUNTIME.history_coalesce_window_ms` (2 s default). The tip's `after`
  is overwritten in place; its `before` — the pre-drag baseline — is
  preserved. `set_param` overrides `coalesce_key` to
  `f"set_param:{layer}:{op}:{param}"` so different sliders never merge
  into each other.
- **Commit.** `52e0e73` (2026-06-12). Same commit fixes 1.6.
- **Lesson.** Undo granularity should match user intent. A drag is one
  intent; without coalescing, the time domain leaked into the history
  domain.

### 5.2 Apply followed by × dismissed the canonical values

- **What broke.** User applies a widget (`accept_widget` writes its
  binding values into canonical), then clicks `×` on the now-accepted
  widget. `delete_widget` → `dismiss_widget` →
  `_reset_canonical_from_widget` rolled the just-committed values back
  to default. The Adjustments sidebar slider returned to its pre-Apply
  position — the opposite of what Apply meant.
- **Fix.** `dismiss_widget` snapshots the pre-dismiss status and skips
  the canonical reset when `was_accepted`. Active-widget close still
  discards. Regression test: accept → close → canonical retains the
  binding value.
- **Commit.** `4c87bcc` (2026-06-16).
- **Lesson.** The two dismiss semantics ("cancel an active widget" vs
  "remove the chrome of a baked widget") share a code path but have
  opposite canonical effects. The discriminator is `widget.status`.

### 5.3 Accept didn't reconcile bindings back to canonical

- **What broke.** Accepting a widget left canonical and binding values
  out of sync — the user's most recent live edits were ignored at bake
  time.
- **Fix.** `accept_widget` reconciles every binding's current value back
  into canonical before promoting the widget to `accepted`.
- **Commit.** `a8c801c` (2026-06-16).

---

## 6 · WebGL pipeline — per-frame churn & correctness

The 2026-06-15 audit closed an entire WebGL cluster in one commit
(`b48dea8`). Each finding had a *real* user-visible symptom.

### 6.1 BT.601 / BT.709 luma drift

- **What broke.** Split-tone's shadow/highlight threshold drifted on
  saturated images.
- **Root cause.** `split-tone.glsl.ts:27` used BT.601 luma
  `(0.299, 0.587, 0.114)` while every other shader (basic-adjustments,
  clarity, sharpen, histogram-compute, lut-parser) used BT.709
  `(0.2126, 0.7152, 0.0722)`.
- **Fix.** Split-tone now uses BT.709. Audit C11.

### 6.2 Layer compositor recursed without cycle guard

- **What broke.** A malformed (cyclic or self-referencing) layer tree
  crashed the tab.
- **Root cause.** `layer-compositor.ts:renderLayer()` followed
  `parentLayerId` recursively with no depth cap, no `Set<seen>`.
- **Fix.** `renderLayer(layer, seen = new Set())` carries a seen-set down
  the chain; bails with a console warning when a cycle is detected.
  Audit C12.

### 6.3 Source texture re-uploaded every frame

- **What broke.** ~100 MB/frame upload at 4K, even when only an
  adjustment param had moved. GPU upload dominated frame time.
- **Root cause.** `WebGLPipeline.setSource()` unconditionally called
  `gl.deleteTexture` + `texImage2D`.
- **Fix.** Keep the existing `WebGLTexture` handle. New
  `setSource(source, dirty=true)` API — when called with `dirty: false`
  on the same identity, the upload is skipped entirely. Audit C13.

### 6.4 Curves shader allocated 4 textures per frame

- **What broke.** ~240 alloc/dealloc per second with curves active.
- **Root cause.** A fresh 256×1 RGBA texture for each of RGB + R + G + B,
  every frame.
- **Fix.** Persistent `curvesLutTextures` cache keyed by `(adjustmentId,
  channel)`. A shared identity LUT allocated once and bound for inactive
  channels. Freed in `clearLutCache` / `dispose`. Audit H14.

### 6.5 FBO recreation blocked the main thread on zoom

- **What broke.** Zooming a 4K image blocked the main thread 10–50 ms.
- **Root cause.** `resizeFBOs()` deleted/recreated all four FBOs
  unconditionally on any size delta.
- **Fix.** Resize FBO textures in place via `texImage2D` on the existing
  handles. Audit H15.

### 6.6 Scratch canvas downscale not memoised

- **What broke.** Per-frame `drawImage` downscale of the scratch canvas
  regardless of state.
- **Fix.** New `getMemoisedScratchCanvas(imageNodeId, source, w, h)`
  short-circuits when `(source, w, h)` matches the previous render.
  Cleared by `clearInternalCanvasCache`. Audit H16.

### 6.7 Curves rendered grey identity for missing channels

- **What broke.** Channels without curve data rendered as a grey identity
  instead of pass-through.
- **Fix.** Bind identity LUTs for missing channels; type-extend params.
- **Commit.** `180e097` (2026-06-08).

### 6.8 Clarity + Sharpen chroma noise

- **What broke.** Saturated edges got coloured fringing from
  clarity/sharpen passes.
- **Fix.** Apply both passes on **luminance only**, leaving chroma
  untouched.
- **Commit.** `eacd705` (2026-06-09).

### 6.9 Frontend reloaded source texture even when only params moved

(Same as 6.3; both phrasings appear in the audit. Closed by `b48dea8`.)

---

## 7 · AI integration

### 7.1 Empty op_graph because the AI invented node types

- **What broke.** The AI returned `node.type: "warmth"` or
  `"temperature"`, neither of which matches any `ProcessingDefinition`.
  The frontend got an empty graph and rendered the unchanged image.
- **Fix.** System prompt now **enumerates the legal types** (`kelvin`,
  `basic`, `curves`, `levels`, `lut`) and their param ranges. Plus a
  `[OperationGraph] console.log` on materialise for diagnosis.
- **Commit.** `31bcea1` (2026-05-15).
- **Lesson.** A free-form LLM generation that writes to canonical without
  template constraints is the bug class fused-tool *templates* later
  closed structurally (see § 7.5).

### 7.2 Claude's tool-use loop mishandled `$defs`

- **What broke.** `augment_context_soft_fields` consistently returned the
  literal templated form `{"$PARAMETER_NAME": {...}}` instead of filled
  fields. Every required field then failed Pydantic validation.
- **Root cause.** The tool was passing
  `_ContextSoftFields.model_json_schema()` as `input_schema`. Pydantic
  emits `$defs` for nested models (here, `Problem`); Claude's tool-use
  loop mishandled the refs.
- **Fix.** Replace the auto-generated schema with a **hand-written inline
  JSON Schema**: no `$defs`, every nested object spelled out, explicit
  per-field descriptions + enums. `_ContextSoftFields` (the Pydantic
  model) stays as the parse target — it validates what Claude returns,
  which now matches.
- **Commit.** `64575c6` (2026-06-01).
- **Lesson.** Tool-use schemas have to be inlined for nested-object
  payloads with Claude. Auto-generated `$defs` are a sharp edge.

### 7.3 Three suggestion widgets fighting over the same canonical knob

- **What broke.** After analyze, three suggestion widgets each showed a
  "Saturation correction" / "Saturation lift" / "Saturation pop" slider.
  The canonical `basic.saturation` knob ping-ponged between them on
  last-write-wins; the user had no consistent control.
- **Root cause.** The previous dedup pass only checked `fused_tool_id`,
  so `cast_correct` and `warm_grade` (different templates, overlapping
  canonical params) could both ship.
- **Fix.** Track `used_targets: set[tuple[node_type, param_key]]` across
  both the problem-driven pass and the character-match top-up. A
  candidate whose canonical bindings overlap any already-claimed `(op,
  param)` tuple falls through. `_canonical_targets()` derives the set
  from the template's node + binding skeletons.
- **Commit.** `f216773` (2026-06-01).
- **Lesson.** Dedup at the *template* level isn't enough; you have to
  dedup at the *canonical-knob* level. Same-target widgets are
  semantically incompatible regardless of template identity.

### 7.4 Autonomous suggestions scoped to non-existent regions

- **What broke.** A widget scoped to `named_region` (e.g. "floured table
  surface") wrote its canonical params but the renderer had no mask to
  restrict the adjustment — SAM was gated off so per-region masks were
  never precomputed. Apply or any slider tweak changed nothing.
- **Fix.** Override `_scope_for` to always return `global` for autonomous
  suggestions while SAM is off. The original `problem.region_label`
  still lives in `widget.reasoning` so "where the problem is" stays
  discoverable via the Why? popover; only the *scope* changes.
- **Commit.** `9b8e1ed` (2026-06-01).
- **Lesson.** When a feature dependency (SAM) is gated off, downstream
  consumers (region-scoped suggestions) need a degraded mode, not silent
  no-op behaviour.

### 7.5 AI sliders loaded grey instead of violet

- **What broke.** An AI-suggestion slider read as untouched (grey)
  immediately on arrival, even though the AI had just set its value.
  The user had to nudge it to see "AI touched this".
- **Root cause.** `bindingProvenance` short-circuited to `default` (grey)
  when the effective value equalled `binding.default`. For AI
  suggestions, `binding.default` is the AI's *resolved* value (templates
  use `tunable_default=true`), so grey-on-load was the wrong answer.
- **Fix.** Add `neutralValue` to `bindingProvenance`. Compares the
  effective value against the **engine canonical baseline** (0 for
  bipolar, 6500 for kelvin, 1.0 for gamma) instead of the AI's pick.
  `engineNeutralForBinding` moves from a private helper in `BindingRow`
  into the shared engine/registry module so every consumer pulls the
  same definition.
- **Commit.** `1c05271` (2026-06-01).

### 7.6 Kelvin slider direction was inverted

- **What broke.** Pushing the WB slider right made the image *cooler*.
  Every photo editor users had seen does the opposite.
- **Fix.** Flip the shader formula from `kelvinColor / daylight` to
  `daylight / kelvinColor`. The slider value now represents the colour
  temperature being corrected *for* (warmer reading → editor adds
  warmth back).
- **Commit.** `509c049` (2026-06-01).

### 7.7 Cast-correction analyze couldn't reach the snapshot

- **What broke.** Analyse fired but SSE deltas never reached the
  snapshot.
- **Root cause.** `runAnalyse` was hitting a legacy endpoint not wired
  to the SSE bus.
- **Fix.** Route through the tool endpoint so SSE deltas land.
- **Commit.** `15bdcdf` (2026-06-01).

---

## 8 · Workspace & widget UX bugs

### 8.1 Tab swallowed curve clicks

- **What broke.** Clicking the Curves canvas in a tool widget did nothing
  because a drag handler was eating the click.
- **Fix.** Stop dragging from swallowing curve clicks; tighten the drag
  gate.
- **Commit.** `b874461` (2026-05-28).

### 8.2 CurveEditor crash on malformed binding value

- **Fix.** Defensive validation of binding value before consuming.
- **Commit.** `4b8efb2` (2026-06-01).

### 8.3 Per-SVG pointer capture for curves in 2×2 layout

- **What broke.** Curve drags worked in the 4×1 layout but not in the 2×2
  layout because pointer capture was attached to a stale parent SVG.
- **Fix.** Each `<svg>` captures its own pointer events; `svgToPoint`
  now reads `e.currentTarget` instead of using a ref + non-null
  assertion.
- **Commits.** `a8c6f48` (2026-06-09), `977bedc` (2026-06-15).

### 8.4 Compound widget optimistic patches keyed wrong

- **What broke.** The renderer's compound-node merge step read optimistic
  patches by `canon:<layer>:compound`; the dial body was writing by
  *widget id*. The renderer never saw the drag updates.
- **Fix.** Patches now land on the canonical node id and include
  `time_of_day.position` alongside the compiled bundle so the snapshot
  stays internally consistent when the patch clears.
- **Commits.** `f5e3aa5`, `b90e7ad`, `8bcbb85` (2026-06-08).

### 8.5 Circular dial seam math (cyclic compound widgets)

- **What broke.** When the position straddled the 1.0/0.0 seam (e.g.
  scrubbing through midnight), the active wedge desynchronised; in
  degenerate cases the position fell to NaN.
- **Fix.** Rewrite the seam-tracking math; guard against degenerate
  position spans where anchors collapse to the same point.
- **Commits.** `9cc90bb`, `72c8f4c` (2026-06-09).

### 8.6 Tether handles entered through the image body

- **What broke.** Tether edges drew straight lines from a fixed handle on
  the image node to the widget — even when that meant crossing through
  the image to reach a widget on the opposite side.
- **Fix.** `pickTetherHandles` picks the side closest to the widget so
  tethers never cross the body to reach the widget. Handles on all four
  sides; nearest wins.
- **Commit.** `4ae7bec` (2026-06-02).

### 8.7 Widget shell stable positions + offline guards

- A cluster of small but user-visible fixes:
  - **Stable positions + live slider + robust buttons** — `e1fecaa`,
    `e524fbc` (2026-05-28).
  - **`WhyPopover` anchors to its trigger; Apply offline-guarded** —
    `e8def7b` (2026-05-30).
  - **Offline guards on every mutation + unmount race + dedupe** —
    `965c060` (2026-05-30).
  - **Widget shell header is keyboard-reachable** (tabIndex + Enter/Space) — `574cc28`.
  - **Disabled Apply gets `cursor-not-allowed`** for consistency — `83b6b39`.

### 8.8 Crop tab — rotate-then-crop cancelled

- **What broke.** Rotating a cropped image left grey corners (the crop
  rect ran into them).
- **Fix.** Apply rotate-then-crop in geometry + preview; eliminates the
  grey corners.
- **Commit.** `4f7682e` (2026-06-03).

### 8.9 Crop Apply raced the snapshot

- **What broke.** Crop Apply cleared the preview *before* the backend
  snapshot bumped revision, so the image flashed back to uncropped for
  one frame.
- **Fix.** Apply waits for the snapshot revision bump before clearing
  the preview.
- **Commit.** `f25aec2` (2026-06-03).

### 8.10 ImageNode chrome counter-scale (then dropped)

- **What broke.** At low zoom (overview), widgets dwarfed the image they
  were attached to. At high zoom, they felt detached. The original
  approach — `useChromeScale = 1/zoom` counter-scaling every workspace
  element — fixed widget size at screen pixels but made the UI "float."
- **Fix.** Drop the counter-scale entirely. Widgets, image chrome, and
  tether edges live in canvas space (Figma model). At extreme zoom-out,
  widgets collapse to a `MarkerDot` via `useChromeVisible`.
- **Commits.** Four-commit progression `2602578` → `809d761` → `85ac34a`
  → `88da425` → final delete `d535c7a` (2026-06-09 → 2026-06-16).
- **Lesson.** This is a *design-decision evolution*, not a bug-fix: the
  team tried the counter-scale model in good faith and only later
  realised it produced floating chrome. The fix was conceptual, not
  mechanical.

### 8.11 SSE handshake order — masks arrived before they could be read

- **What broke.** On session restore, masks were emitted as SSE events
  before the frontend `maskStore` was ready. Result: missing thumbnails,
  silent skips.
- **Fix.** Open SSE *before* analyze so phase/mask/widget events arrive
  after the subscriber is wired. Populate the frontend `maskStore` from
  backend `mask.created` events explicitly.
- **Commits.** `0bc88ad`, `b0d9d92` (2026-05-28).

### 8.12 Mask resolution exploded memory

- **What broke.** Some images produced multi-MB masks that crashed the
  decoder on the frontend.
- **Fix.** Cap mask resolution to 1024 max edge backend-side.
- **Commit.** `bf5f2ab` (2026-06-15).

### 8.13 SAM ORT-Web vendoring & WASM serving

- **What broke.** `onnxruntime-web` couldn't find its WASM assets in
  production; Vite's importAnalysis was hijacking the `/ort/*` path.
- **Fix.** Vendor ORT-Web WASM assets locally; set `wasmPaths` to the
  vendored copy. Vite middleware serves `/ort/*` assets before
  importAnalysis runs.
- **Commits.** `9b8aa63`, `be54e08` (2026-06-15).

### 8.14 MobileSAM encoder ran on mount

- **What broke.** Loading any image triggered the MobileSAM encoder
  even when the user never opened Objects-Mode — large CPU cost.
- **Fix.** Defer encoder run until the first `decode()` call.
- **Commit.** `35f1130` (2026-06-11).

---

## 9 · Smaller-but-instructive fixes

### 9.1 Zustand draft is frozen — palette layer sort crashed

- **What broke.** Sorting the layers array inside the palette mutated the
  Immer draft and threw "Cannot assign to read only property of object".
- **Fix.** Copy before sort.
- **Commit.** `26dd2b8` (2026-05-28).

### 9.2 Pointer coords vs image space hit-test

- **What broke.** Click-to-segment hit-tests on the *display* canvas
  coordinates, not the image-space coordinates, so segment regions on a
  zoomed-out image were selected in the wrong place.
- **Fix.** Convert pointer coords to image space before hit-test.
- **Commit.** `b5a92ed` (2026-05-28).

### 9.3 Selection tool committed mask in the wrong handler

- **What broke.** `onPointerUp` could fire before SAM segmentation
  resolved, so the mask "committed" was empty.
- **Fix.** Move the commit into `onPointerDown` so it precedes the
  async segment work.
- **Commit.** `28d4d71` (2026-05-15).

### 9.4 LayersPanel crashed on ai-panel layers

- **What broke.** The icon table didn't have an entry for `ai-panel`
  layers; the Panel crashed on render.
- **Fix.** Add the entry; fall back to a generic icon for unknown types.
- **Commit.** `29c21ec` (2026-05-15).

### 9.5 EDP reload didn't re-analyze

- **What broke.** After opening a `.edp` project file or restoring a
  session, Cmd+K was unusable — image_context was missing.
- **Fix.** Trigger re-analyze after `.edp` open and session restore.
- **Commit.** `66c085a` (2026-05-15).

### 9.6 Inspector didn't re-render on adjustment add/remove

- **What broke.** Adding an adjustment to a layer didn't update the
  inspector — selector only watched `layers.length`.
- **Fix.** Subscribe to the right shape; recompute on add/remove.
- **Commit.** `ed93465` (2026-05-28).

### 9.7 Slider rate-limit floods + 429 console spam

- **What broke.** Fast slider drags fired one `set_widget_param` per
  optimistic patch; the backend rate-limited; the frontend logged a 429
  stream as "Uncaught (in promise)" errors.
- **Fix.** `WidgetShell.setParam` now coalesces `set_widget_param`
  writes per `(widget, paramKey)` on a 100 ms timer.
  `backendTools.invokeTool` returns a soft-fail envelope on HTTP 429 so
  fire-and-forget callers don't surface "Uncaught" promise rejections.
- **Commit.** `2ce7234` (2026-06-15).

### 9.8 Reload pixelVersion didn't bump

- **What broke.** After source bytes landed via restore, the canvas
  didn't repaint because the version flag the renderer watched hadn't
  changed.
- **Fix.** Bump `pixelVersion` as sources land.
- **Commit.** `ab32630` (2026-06-16).

### 9.9 Apply waits for snapshot revision before clearing preview

(Same family as 8.9; cited for emphasis. The pattern *wait for backend
acknowledgement before mutating local state* recurs throughout the
codebase as a fix for "snapping back" UX bugs.)

### 9.10 Two reverts that taught caution

- `0ebb42a` → `690091f` — CSS-based rotate/flip/crop was reverted after
  landing; the 2D-canvas transform approach (`338c1c0`) won.
- `e978eef` → `f98bf45` — CurveEditor's internal Reset button was
  removed, then restored a few hours later.
- **Lesson.** Reverts are part of the project's normal cadence. The
  signal in them is not "we got it wrong"; it's "we made a decision, ran
  it, and the running showed us something the design step couldn't."

---

## 10 · The big editorial bug — old context drift

Beyond individual fixes, this codebase has a *structural* tendency that
the audit explicitly names: **SSoT drift**. The same value living in two
places, and the two places disagreeing. The recurring pattern is:

1. A feature is shipped quickly, with state on both the backend and the
   frontend.
2. The two states diverge under one of: race, restart, undo, persistence.
3. A bug surfaces *not* as "wrong value" but as a *silent inconsistency*
   (skipped writes, dropped fields, stale renders).
4. The fix is almost always *deletion*: collapse one place to a *view*
   of the other.

The reductions that have landed:

| Drift | Number of places (before → after) | Closed by |
|---|---|---|
| Param hooks (canonical/processing/graph-adjustment/adjustment) | 4 → 1 | `c520261`/`bde4617`/`8616011`/`7ee9651` (H20) |
| Fused-tool resolvers | 17 files of boilerplate → 2 special cases over a base | `8afc421` … `15382ff` (H21) |
| Engine registry (loader / `ENGINE_OPS` / `tool_defaults`) | 3 → 1 | `527c2b2` (H23) |
| Widget spawn entry points | 2 → 1 | `21db7d5` + `897ef86` + `f843b1c` (H24) |
| Widget acceptance paths | 2 → 1 | `b332105..d576f7f` (H4) |
| Image-context (singleton vs per-node) | 2 → 1 | per-node migration cluster (C3/H9) |
| Session-creation payload validation | 2 → 1 helper | `d6a197c` |
| Toolrail spawn gate logic | 2 → 1 | `2a88a57` (H22) |
| Inspector-folder primitives leaking into `widget/` | many → tier rule restored | 6 commits ending at `b266942` (H25) |
| WebGL chrome counter-scale | 1 path with hack → none (Figma model) | `2602578..d535c7a` |

The thesis-relevant point: **deletion is more powerful than addition** in
this codebase. Each row above is a class of bug closed by removing one
of the two sources.

---

## 11 · A short list of patterns the codebase learnt

These are not commits — they're invariants extracted from the commits
above. The second agent can write them up as design principles the
project arrived at empirically.

1. **`extra='forbid'` on every Pydantic wire model.** Silent drops are
   worse than crashes (Family 3).
2. **Async handler + sync SDK = `to_thread`.** Any blocking SDK call from
   an async FastAPI handler routes through `asyncio.to_thread` (1.2).
3. **Locks across `await` boundaries are dangerous.** Use `asyncio.Lock`
   for async code; if you have a `threading.Lock`, never `await` while
   holding it (1.4).
4. **Object-identity selectors must return stable references.** Hoist
   empty fallbacks to module scope (1.8).
5. **Defer cross-store mutations.** Inside an Immer producer, queue side
   effects; drain after `set(...)` returns (1.7).
6. **Stale-write guards on every debounced write.** Re-check the value is
   still relevant before sending (1.6, 1.9).
7. **One place for one value.** When two stores hold the same value,
   delete one (Family 4 / § 10).
8. **Wait for backend acknowledgement before clearing local preview
   state.** Snap-back UX bugs are mostly this (8.9).
9. **Hand-write LLM tool schemas; do not auto-generate `$defs`** (7.2).
10. **Dedup at the canonical-knob level, not the template level**, when
    multiple AI templates can write to the same param (7.3).
11. **Loud failures over silent skips** (4.8).
12. **Lazy globals need locks.** Singletons constructed on first use in
    a multi-worker server need a mutex around the construction (1.3).
13. **Persist everything the rebuild depends on.** A subscriber that
    captures only a narrow slice and a rebuild that auto-generates the
    rest will drift the moment the rebuild rule changes (2.4).

---

## 12 · What to write *about* (priority order)

When the second agent uses this brief to write thesis text, the
highest-yield narratives are:

1. **The camelCase migration** (Family 3) — a multi-week, all-touching
   fix that demonstrates how a single Pydantic default (`extra='ignore'`)
   converts type bugs into invisible data loss. Nine commits, every one
   reachable. Best illustrated bug.
2. **The lock-across-await deadlock** (1.4) — a textbook example of a
   sync mutex meeting an async runtime. The fix is "serialise the
   chain"; the proper fix (asyncio.Lock) is TODO'd. Honest scope is
   part of the story.
3. **The SAM init race that surfaced as a CORS error** (1.3) — the
   misleading-error-message story. Worth a paragraph on why this kind
   of bug is so hard to triage.
4. **History coalescing + stale-write guard** (5.1 + 1.6) — the
   undo-pipeline story, with a clear UX win.
5. **WebGL per-frame churn cluster** (Family 6) — concrete performance
   numbers (~100 MB/frame upload, ~240 textures/s) and a single commit
   (`b48dea8`) that closed them all.
6. **AI-suggestion canonical-knob dedup** (7.3) — the example of
   "different templates can write to the same param" and why that
   surfaces as "three sliders all called Saturation".
7. **Source-of-truth drift as a recurring family** (§ 10) — the
   architectural lesson. The reductions list is the rhetorical spine.
8. **Workspace graph persistence** (2.4) — the symptom (grey layers
   collapsed onto one node) → cause (missing six fields in the
   write-through subscriber). A clean walking-the-render-path story.
9. **The "Apply then ×" canonical-rollback bug** (5.2) — small,
   clean, easy to explain, and shows the discriminator-on-status
   pattern.
10. **Counter-scale → Figma model** (8.10) — a design-decision
    evolution, not a bug fix, but worth telling for honesty about how
    the team learnt the right answer by shipping the wrong one.

Every fact above is sourced from a real commit in `git log`; cite the
SHA in the narrative for verifiability.
