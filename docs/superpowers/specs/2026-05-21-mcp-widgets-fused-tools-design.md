# MCP Widget Surface + Fused Tools — Backend Design

**Date:** 2026-05-21
**Scope:** Backend only. Frontend integration is described where it touches backend contracts, but the frontend implementation is out of scope for this spec.
**Status:** Design — awaiting plan.

---

## Why

The editor's AI today is a one-shot vending machine: the frontend posts `/api/panel`, the backend asks Claude for one big `OperationGraph` blob, the frontend renders sliders. Two structural problems:

1. **Recipes aren't reliable.** Claude invents the node-graph structure on each call. "Warmer" comes back as a kelvin shift one day and a basic-highlights cocktail the next.
2. **The frontend owns the document.** Layers, masks, adjustments all live in browser Zustand. Nothing outside the tab can drive the editor, so a real MCP integration is impossible.

This design moves authoritative state onto the backend, introduces a `BackendToolRegistry` exposed via two transports (wire-format MCP + generated REST), and re-shapes the LLM's output as composable first-class **widgets** assembled from a small catalog of **fused tools** (Python-templated structure + Claude-tuned numbers).

Goals:

- **External Claude clients can drive the editor over MCP.** Same tool surface the in-app AI uses.
- **Fused tools are reliable.** Skeleton fixed in Python, numbers tuned per image, envelope-clamped.
- **Widgets are addressable.** Per-widget `refine` (composition edit), `repeat` (re-roll), `delete` (dismiss + suppress) — without regenerating the whole graph.
- **LLM can propose widgets autonomously.** A post-`/analyze` pass reads the enriched image context's `problems[]` and mints suggestion-tray widgets.

Non-goals:

- Full WebGL parity on the backend. A CPU-approximation preview renderer is sufficient for v1.
- Real-time multi-user collaboration. Concurrent edits are protected by a per-session write lock, no CRDT.
- Replacing the frontend's render pipeline. The frontend still consumes `OperationGraph` and renders it.

---

## Architectural decisions (locked)

| # | Decision | Implication |
|---|---|---|
| 1 | **Real wire-format MCP server** | Mount streamable-HTTP MCP at `/mcp`. External Claude clients connect; the same tools are usable internally. |
| 2 | **Backend owns document state** | `SessionDocument` aggregate on the backend is authoritative. Browser becomes a renderer over an SSE state stream. |
| 3 | **Widgets are first-class objects** | Each has its own id in a `widgets` collection. The `OperationGraph` the frontend renders is a *projection* of the active widget set, not the stored unit. |
| 4 | **Composite widget shape** | One widget = header + reasoning + ordered list of `ControlBinding`s + scope + preview + before/after. Multi-control by default. |
| 5 | **Hybrid fused-tool resolution** | Python templates declare fixed structure + a parameter envelope. Claude fills in per-image numbers. Out-of-envelope answers are clamped + retried, with a deterministic seed fallback after triple-miss. |
| 6 | **Single canonical registry, two transports** | `BackendToolRegistry` is the source of truth. `/mcp` and `/api/tools/<name>` are pure framing layers. `set_widget_param` is REST-only. |

---

## Module layout

```
backend/app/
  main.py                              # mount mcp_router at /mcp
  api/
    analyze.py                         # unchanged surface; switches to enriched ImageContext v2
    panel.py        ← thin shim       # delegates to tools.propose_widget for compat
    refine.py       ← thin shim       # delegates to tools.refine_widget for compat
    segment.py                         # unchanged
    session.py                         # unchanged
    state.py            (new)          # GET /api/state/{sid} snapshot + SSE event stream
    tools_rest.py       (new)          # REST adapter: POST /api/tools/<name>
  mcp/                  (new)
    server.py                          # streamable-HTTP MCP endpoint
    session.py                         # MCP session → editor session_id mapping
    transport.py                       # SSE framing for tool notifications
  tools/                (new)
    registry.py                        # BackendToolRegistry (singleton)
    base.py                            # BackendTool protocol, error envelope, permissions
    atomic/                            # query + atomic-mutate tools
      get_image_context.py
      list_named_regions.py
      list_layers.py
      list_widgets.py
      get_widget.py
      preview_widget.py
      list_fused_tools.py
      get_active_selection.py
      select_named_region.py
      select_by_point.py
      select_by_box.py
      combine_masks.py
      clear_selection.py
      apply_adjustment.py
      highlight_region.py
      add_note.py
      create_session.py
      analyze_image.py
    widgets/                           # widget lifecycle tools
      propose_widget.py
      refine_widget.py
      repeat_widget.py
      delete_widget.py
      restore_widget.py
      accept_widget.py
      set_widget_param.py              # REST-only; expose_mcp=False
    fused_framework.py                 # template + Claude resolver + envelope validator
    fused/                             # fused-tool catalog
      __init__.py                      # registers all fused tools at startup
      warm_grade.py
      cool_grade.py
      exposure_balance.py
      sky_recovery.py
      portrait_glow.py
      bw_cinematic.py
      cast_correct.py
      teal_orange.py
      subject_pop.py
  state/                (new)
    document.py                        # SessionDocument aggregate
    widget.py                          # Widget, ControlBinding, WidgetPreview models
    operations.py                      # project_to_graph(doc) → OperationGraph (pure function)
    events.py                          # StateEvent + per-session event bus
    preview_renderer.py                # CPU-approximation thumbnail renderer for preview_widget
  schemas/
    image_context.py    (extended)     # EnrichedImageContext v2
    widget.py             (new)        # Widget + ControlBinding shape (mirrors state/widget.py)
    operation_graph.py                 # unchanged
    errors.py             (new)        # ToolError envelope
  services/
    anthropic_client.py (extended)     # adds resolve_fused_tool + name_pick_fused_tool
    sam_client.py                      # unchanged
    session_store.py (extended)        # stores SessionDocument; emits StateEvents
```

Module boundary rules:

- `tools/` is the only place new LLM capabilities are defined. New tool = new file under `tools/atomic/`, `tools/widgets/`, or `tools/fused/`.
- `state/` is the only place that mutates session document state. Every mutating handler routes through it.
- `mcp/` and `api/tools_rest.py` carry zero business logic — they translate wire format ↔ registry call.
- `fused/*.py` self-register via `tools/fused/__init__.py` at startup.

---

## Data model

### `SessionDocument`

```python
class SessionDocument(BaseModel):
    session_id: str
    image_bytes: bytes
    mime_type: str
    image_context: EnrichedImageContext            # v2; see below
    masks: dict[MaskId, MaskRecord]                # SAM-decoded, painted, or named-region masks
    widgets: dict[WidgetId, Widget]                # authoritative widget set
    widget_order: list[WidgetId]                   # render order; drives projection
    dismissals: list[DismissalRule]                # per-session suppression for autonomous suggestions
    notes: list[Note]                              # sticky annotations
    history: list[StateEvent]                      # append-only audit log
    revision: int                                  # monotonic; bumped on every event
    created_at: datetime
    updated_at: datetime

class MaskRecord(BaseModel):
    id: MaskId
    width: int
    height: int
    png_b64: str                                   # 1-channel mask, 0/255
    source: Literal["sam_point", "sam_box", "named_region", "painted", "combined"]
    parent_mask_ids: list[MaskId] = []             # populated for source="combined"
    label: str | None                              # set when this mask backs a named region

class Note(BaseModel):
    id: str
    text: str
    anchor: NoteAnchor                             # region | point | image
    created_at: datetime
```

### `Widget`

```python
class Widget(BaseModel):
    id: WidgetId
    intent: str                                    # header text
    reasoning: str | None
    scope: Scope                                   # global / named_region / mask / point-cluster
    origin: WidgetOrigin
    fused_tool_id: str | None                      # None for ad-hoc / composed widgets
    composed: bool = False                         # True once refine has altered the skeleton
    nodes: list[WidgetNode]                        # node-graph fragment owned by this widget
    bindings: list[ControlBinding]                 # ordered controls
    preview: WidgetPreview
    rejected_attempts: list[ResolvedNumbers]       # repeat-widget rejection anchors
    status: Literal["active", "dismissed"]
    revision: int                                  # bumped on refine/repeat/value edits
    created_at: datetime
    updated_at: datetime

class WidgetOrigin(BaseModel):
    kind: Literal["mcp_user_prompt", "mcp_autonomous", "user_palette", "fused_expansion"]
    prompt: str | None                             # set when kind=mcp_user_prompt
    parent_widget_id: WidgetId | None              # set for fused_expansion / repeat / refine genealogy
```

### `ControlBinding`

```python
class ControlBinding(BaseModel):
    param_key: str
    label: str
    control_type: ControlType
    target: NodeParamTarget                        # {node_id, param_key}
    schema: ControlSchema                          # discriminated union on control_type
    value: ControlValue
    default: ControlValue                          # restoring default = no-op effect
    reasoning: str | None
```

### `WidgetPreview`

```python
class WidgetPreview(BaseModel):
    kind: Literal["thumbnail", "histogram_delta", "color_swatches", "none"]
    auto_before_after: bool                        # if True, frontend renders a synthetic toggle
```

### `WidgetNode`

```python
class WidgetNode(BaseModel):
    id: NodeId
    type: str                                      # ProcessingDefinition kind: kelvin, basic, curves, lut, levels
    params: dict[str, ParamValue]
    scope: Scope
    inputs: list[NodeId]
    widget_id: WidgetId                            # back-pointer for projection
```

### `DismissalRule`

```python
class DismissalRule(BaseModel):
    id: str                                        # rule id (uuid)
    source_widget_id: WidgetId                     # the widget whose delete created this rule
    intent_norm: str                               # lowercased + stop-words stripped
    scope_signature: str                           # fingerprint of resolved scope (label or mask hash)
    fused_tool_id: str | None
    created_at: datetime
```

The autonomous-suggestion pass consults `dismissals[]` and skips a proposal when an existing rule matches **all** of: `fused_tool_id == rule.fused_tool_id` AND `scope_signature == rule.scope_signature` AND `intent_norm == rule.intent_norm`. `intent_norm` matching keeps the rule narrow — dismissing "warm subject" doesn't suppress "cool subject" on the same scope. `restore_widget` finds the rule with `source_widget_id == widget_id` and removes it from `dismissals[]`.

### Projection (pure function)

```python
# state/operations.py
def project_to_graph(doc: SessionDocument) -> OperationGraph:
    """Render active widgets as a flat OperationGraph.
       Iterates doc.widget_order; for each active widget, emits its nodes
       and bindings into the OperationGraph shape. Pure — no I/O."""
```

The frontend reads the projected graph from `/api/state/{sid}` and `/api/state/{sid}/events`; it never derives it locally.

---

## EnrichedImageContext (v2)

Additive extension of today's `ImageContext`. v1 fields stay; new fields are populated by `/analyze`. Stats are computed locally (numpy/cv2); soft fields are emitted by Claude.

### Cheap pass (local, deterministic)

```python
class EnrichedImageContext(ImageContext):
    luma_histogram: list[int]                      # 256 bins, normalised
    rgb_histograms: dict[str, list[int]]           # r/g/b, 256 bins each
    clipped_shadows_pct: float                     # % L ≤ 4
    clipped_highlights_pct: float                  # % L ≥ 251
    median_luma: float                             # 0..255
    contrast_p10_p90: float                        # global contrast proxy
    color_palette: list[ColorSwatch]               # 8 k-means swatches
    cast_strength: float                           # 0..1
    cast_direction: tuple[float, float]            # (a*, b*)
    region_stats: list[RegionStats]                # one per candidate_region, same order
```

### Claude-augmented pass (one extra tool call inside `analyze_image`)

```python
class EnrichedImageContext(ImageContext):
    # ...
    estimated_white_point: tuple[float, float, float]
    wb_neutral_confidence: float                   # 0..1
    grade_character: str                           # "warm-amber" | "cool-cinematic" | "neutral" | ...
    problems: list[Problem]                        # see below
    # plus per-region soft fields: is_skin_likely, is_sky_likely
```

### `Problem`

```python
class Problem(BaseModel):
    kind: Literal["clipped_highlights", "crushed_shadows", "low_contrast",
                  "strong_color_cast", "noisy_shadows", "uneven_white_balance"]
    severity: float                                # 0..1
    region_label: str | None
    bbox: list[float] | None
    suggested_fused_tools: list[str]               # e.g. ["sky_recovery", "exposure_balance"]
```

`problems[]` drives autonomous widget proposal. Inside `analyze_image`, after the cheap + Claude-augmented passes complete, a third pass mints one widget per high-severity problem by calling `propose_widget(intent=..., scope=..., fused_tool_id=suggested_fused_tools[0], origin=mcp_autonomous)`. These land in the suggestions tray until the user `accept_widget`s them.

### Deferred (out of v2)

- `focus_map_downscaled` and `sharpness_score`. Cheap focus widgets (sharpen, lens-blur) will need them in v3.
- Face landmarks. Semantic segmentation map. Salience map. None needed for v1 fused tools.

---

## BackendToolRegistry

### `BackendTool` shape

```python
class BackendTool(Generic[TIn, TOut]):
    name: str                                      # snake_case stable id
    kind: Literal["query", "mutate", "emit"]
    description: str
    usage: str | None
    input_schema: type[BaseModel]
    output_schema: type[BaseModel]
    permissions: ToolPermissions
    async def handler(self, doc: SessionDocument, input: TIn) -> TOut: ...

class ToolPermissions(BaseModel):
    expose_mcp: bool = True
    expose_rest: bool = True
    requires_image: bool = True
    requires_context: bool = False                 # rejected if analyze_image hasn't run
```

### `BackendToolRegistry`

```python
class BackendToolRegistry:
    def register(self, tool: BackendTool) -> None: ...
    def get(self, name: str) -> BackendTool: ...
    def list_for(self, transport: Literal["mcp", "rest"]) -> list[BackendTool]: ...
    async def invoke(self, name: str, session_id: str, raw_input: dict) -> dict:
        """Single entry point.
           1. Resolve session → SessionDocument (under per-session write lock if mutate).
           2. Check permissions (requires_image, requires_context).
           3. Validate raw_input against input_schema.
           4. Run handler.
           5. Emit any pending StateEvents.
           6. Return Pydantic-dumped output, wrapped in {ok, output} | {ok:false, error}."""
```

Both transports go through `registry.invoke()`. They are pure framing.

### REST adapter

```python
# api/tools_rest.py
@router.post("/tools/{name}")
async def invoke_rest(name: str, body: ToolEnvelope) -> ToolResponseEnvelope:
    return await registry.invoke(name, body.session_id, body.input)
```

### MCP adapter

`mcp/server.py` implements streamable-HTTP MCP framing:

- `initialize` → returns server capabilities + advertised tool count.
- `tools/list` → `registry.list_for("mcp")` serialised to MCP tool descriptors.
- `tools/call` → `registry.invoke(name, mcp_session.editor_session_id, args)`.
- `notifications/*` → SSE channel pushes `StateEvent`s converted to MCP notifications (so MCP clients see concurrent changes from the connected browser).

Session identity over MCP: the streamable-HTTP MCP endpoint takes an `editor_session_id` header on the initial handshake; `mcp/session.py` maps the MCP transport session → editor session for the connection's lifetime. External clients call `create_session` first (over REST or MCP — both expose it) and pass the returned id thereafter.

---

## MCP tool catalog

### Query (read-only)

| Tool | Purpose |
|---|---|
| `get_image_context` | Returns full `EnrichedImageContext`. First call any agent should make. |
| `list_named_regions` | Compact summary: `label`, `description`, `has_mask`, `tonal_stats_summary`. |
| `list_widgets` | All widgets: `id`, `intent`, `origin.kind`, `status`, `revision`, `scope`. |
| `get_widget` | Full body of one widget. Used before `refine_widget`. |
| `list_layers` | Layer summary (unchanged from today). |
| `list_fused_tools` | Catalog: `id`, `description`, `typical_use`, `param_envelope`. |
| `get_active_selection` | What mask is armed (label, source, dimensions). |
| `preview_widget` | Returns a small JPEG of the widget rendered against the image at current values. Backend-rendered via the CPU pipeline (see `preview_renderer.py`). |

### Selection (mutate, narrow)

| Tool | Purpose |
|---|---|
| `select_named_region` | Arm a Claude-named region. Resolves mask via cached SAM if needed. |
| `select_by_point` | `(x, y)` → SAM decode → mask. Cached per `(session, point)`. |
| `select_by_box` | Box-style selection via SAM. |
| `combine_masks` | `{ op: "union" \| "intersect" \| "subtract", a, b } → new MaskId`. |
| `clear_selection` | Discard active + committed. |

### Widget lifecycle (mutate, headline)

| Tool | Purpose |
|---|---|
| `propose_widget` | Mint a widget. Inputs: `intent`, `scope`, optional `fused_tool_id`, optional `prompt`. If `fused_tool_id` is given, that template is used. Otherwise the backend picks one via a small `name_pick_fused_tool` Claude call (single tool_use, fixed schema `{ chosen_id: str | null, reasoning: str }`, choices = `list_fused_tools()`); a `null` answer routes to the ad-hoc path. Output: full `Widget`. |
| `refine_widget` | Composition edit. Inputs: `widget_id`, `edits[]` (keep/remove per binding), `additions[]` (short-phrase requests for new bindings), optional `instruction`. Removes, adds, re-resolves numbers across the new set. Bumps `revision`. Composition changes set `composed=true` and graduate the widget out of pure fused-tool mode. |
| `repeat_widget` | Re-roll. Inputs: `widget_id`, optional `feedback`. Re-resolves the same template with the prior values added to `rejected_attempts`; resolver prompt asks for a meaningfully different result. Same `widget_id`, `revision++`. |
| `delete_widget` | Inputs: `widget_id`, `suppress_similar: bool = True`. Sets `status="dismissed"`. If suppressing, appends a `DismissalRule`. |
| `restore_widget` | Inputs: `widget_id`. Un-dismisses + revokes the matching dismissal rule. |
| `accept_widget` | Inputs: `widget_id`. Moves an `origin.kind="mcp_autonomous"` widget from the suggestions tray into the active panel. |

### Atomic action

| Tool | Purpose |
|---|---|
| `apply_adjustment` | Direct WidgetNode without bindings — for confident mechanical fixes (e.g. "auto-level"). Produces a tiny read-only widget. |

### Emit / annotation

| Tool | Purpose |
|---|---|
| `highlight_region` | "Look at this." Arms active overlay only. |
| `add_note` | Sticky note anchored to image / region / point. |

### Session lifecycle

| Tool | Purpose |
|---|---|
| `create_session` | `{ image_url \| image_b64 } → session_id`. MCP-friendly mirror of today's `POST /session`. |
| `analyze_image` | Triggers (or returns cached) `EnrichedImageContext`. Also runs autonomous-suggestion pass. Idempotent. |

### Permission matrix

| Tool | MCP | REST |
|---|---|---|
| All `query` tools | ✓ | ✓ |
| All selection tools | ✓ | ✓ |
| All widget-lifecycle tools | ✓ | ✓ |
| `apply_adjustment` | ✓ | ✓ |
| `highlight_region`, `add_note` | ✓ | ✓ |
| `create_session`, `analyze_image` | ✓ | ✓ |
| `set_widget_param` | ✗ | ✓ |

`set_widget_param` is REST-only because slider-dragging at 60fps is a human pointing-device action, not an agent action. Exposing it over MCP would invite an LLM to micro-control sliders, which is the wrong abstraction.

---

## Widget control catalog

`ControlSchema` is a Pydantic discriminated union on `control_type`. Strict validation at the registry boundary.

| `control_type` | Schema | Value | When picked |
|---|---|---|---|
| `slider` | `{min, max, step, unit}` | `float` | Continuous scalar with bounds. |
| `numeric_pair` | `{min_a, max_a, step_a, label_a, …b}` | `[float, float]` | Two-axis adjustments (temp+tint). |
| `toggle` | `{on_label, off_label}` | `bool` | Binary modifiers (skin protect). |
| `choice` | `{options:[{value,label,swatch?}], allow_custom}` | `string` | Discrete picks (blend mode, LUT). |
| `color` | `{space, show_alpha, presets}` | `[int,int,int]` or `[int,int,int,float]` | Tints, grades. Default seeded from `color_palette`. |
| `curve` | `{channel, min_points, max_points}` | `[[float,float], …]` | Tone curves. |
| `curve_point` | `{channel, x_min, x_max, y_min, y_max}` | `[float, float]` | Single-handle curve pull. |
| `mask_thumbnail` | `{allow_replace, allow_combine:["union","intersect","subtract"]}` | `{mask_id}` | Bound-mask display + swap/combine. |
| `region_picker` | `{candidate_labels, allow_active_selection, allow_global}` | `{kind, label?}` | Scope picker as a first-class control. |
| `before_after_toggle` | `{split_orientation: "horizontal"\|"vertical"\|"swap"}` | `bool` | **Synthetic**. Auto-injected from `WidgetPreview.auto_before_after=true`. |
| `histogram_marker` | `{channel, marker_kind: "black_point"\|"white_point"\|"gamma"}` | `float` | Histogram-anchored handle for levels. |
| `text` | `{max_len, placeholder}` | `string` | Free-text params. Rare. |

Defaults requirement: every binding's `default` value must yield a no-op effect when restored (kelvin offset = 0, intensity = 0, etc.). The frontend's "reset" affordance is just `set_widget_param(widget_id, param_key, default)`.

Auto-injected region picker: any widget with non-global scope gets an implicit `region_picker` binding unless the resolver opts out with `lock_scope=true`. Lets the user "move this widget to a different region" via one control change, which triggers a backend re-resolve over the new scope.

Excluded from v1: `gradient_editor`, `2d_pad`, `radial_picker`, `keyframe_track`. No v1 fused tool needs them.

---

## Fused-tool framework

### Template shape

```python
class FusedToolTemplate(BaseModel, ABC):
    id: str
    description: str
    typical_use: str

    # structural promises (NEVER vary between revisions of one widget)
    node_skeleton: list[NodeSkeleton]
    bindings_skeleton: list[BindingSkeleton]
    preview: WidgetPreview
    requires_scope: Literal["any", "non_global", "named_region", "skin_safe"]

    # envelope — clamps applied at the framework boundary
    param_envelope: dict[str, ParamRange]
    safety: SafetyRules

    # inputs the resolver reads (declarative; drives prompt assembly + cache key)
    context_inputs: list[ContextField]

    @abstractmethod
    async def resolve(
        self,
        intent: str,
        scope: ResolvedScope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: AnthropicClient,
    ) -> ResolvedNumbers: ...

class NodeSkeleton(BaseModel):
    node_type: str                                 # kelvin, basic, curves, lut, levels
    fixed_params: dict[str, ParamValue]
    tunable_param_keys: list[str]

class BindingSkeleton(BaseModel):
    param_key: str
    label: str
    control_type: ControlType
    schema: ControlSchema
    target: NodeParamTarget
    tunable_default: bool

class ParamRange(BaseModel):
    min: float
    max: float
    step: float
    skin_safe_max: float | None
```

### Framework runner

```python
async def run_fused_tool(
    template: FusedToolTemplate,
    intent: str, scope: ResolvedScope, ctx, prior, instruction, anthropic,
) -> Widget:
    for attempt in range(3):
        try:
            numbers = await template.resolve(intent, scope, ctx, prior, instruction, anthropic)
        except ResolverError:
            continue
        clamped = clamp_to_envelope(numbers, template.param_envelope,
                                    scope_is_skin=scope.is_skin_likely)
        if clamped == numbers:
            return build_widget(template, scope, clamped)
        # Claude went out of envelope — retry with clamp note in the prompt.
    # Triple-miss: deterministic seed from envelope midpoints.
    return build_widget(template, scope, default_seed(template.param_envelope))
```

Guarantees:

- The envelope is enforced by the framework, not the prompt. Out-of-range values get clamped or rejected.
- `prior_widget` is the refine/repeat hook. Skeleton can't change between revisions of one widget.
- The framework never refuses to produce a widget. A mediocre seeded one is better than a broken UX.
- Skin safety is automatic: if `requires_scope="skin_safe"` and `scope.is_skin_likely`, every binding's `skin_safe_max` overrides its `max`.

### Starter catalog (v1)

| `id` | Skeleton | Tunable | Context reads |
|---|---|---|---|
| `warm_grade` | `kelvin` + `basic`(highlights, saturation) | kelvin offset, highlight warmth, sat lift | `cast_direction`, `wb_neutral_confidence`, region `mean_rgb` |
| `cool_grade` | mirror of `warm_grade` | mirror | mirror |
| `exposure_balance` | `basic`(shadows, highlights, whites, blacks) | 4 params, skin-clamped on skin scope | `luma_histogram`, `clipped_*_pct`, `median_luma` |
| `sky_recovery` | `basic` + `curves` | highlight roll-off, curve points, blue sat | `clipped_highlights_pct`, sky region swatches |
| `portrait_glow` | `basic` + `kelvin` slight | clarity reduction, kelvin nudge | region `is_skin_likely`, `mean_luma`, skin swatches |
| `bw_cinematic` | `lut`(B&W preset) + `curves` | curve point positions | `contrast_p10_p90`, `luma_histogram` |
| `cast_correct` | `kelvin` + `basic`(per-channel sat via curves) | corrective kelvin, channel-sat deltas | `estimated_white_point`, `cast_direction` |
| `teal_orange` | `curves`(per channel) + `basic`(sat) | per-channel curve targets | `grade_character`, `color_palette` |
| `subject_pop` | `basic`(contrast, sat) scoped to region | contrast, sat | region `contrast_p10_p90`, `is_skin_likely` |

Each fused tool is one file in `tools/fused/`. Adding a new one is a copy-paste-edit; `tools/fused/__init__.py` discovers and registers them at startup.

### `propose_widget` flow

```
propose_widget(intent, scope, fused_tool_id?)
  │
  ├─ resolve scope → mask (SAM, cached if seen)
  ├─ if fused_tool_id given: load template
  │  else: name_pick_fused_tool(intent) → fused_tool_id | None (one small Claude call)
  │
  ├─ run_fused_tool(template, intent, scope, ctx, prior=None, instruction=None, anthropic)
  ├─ build_widget(...) → Widget
  ├─ doc.add_widget(widget) → emits widget.created
  └─ return widget
```

### `refine_widget` flow (composition edit)

```
refine_widget(widget_id, edits[], additions[], instruction?)
  │
  ├─ widget = doc.widgets[widget_id]
  ├─ apply edits → trimmed binding list (kept = !remove)
  ├─ for each addition:
  │    Claude is asked, given the widget + the request phrase, to emit
  │    one ControlBinding + any WidgetNode additions it needs.
  │    Output is envelope-validated.
  ├─ if composition changed (additions ≠ [] OR removals ≠ []):
  │    widget.composed = True
  │    widget.fused_tool_id retained as back-reference only
  │
  ├─ re-resolve numbers across the resulting binding set
  │    kept bindings: their current `value` is preserved; resolver re-emits `default`
  │      only if the surrounding skeleton changed enough to invalidate it.
  │    new bindings: resolver supplies both `value` and `default`.
  │
  ├─ doc.update_widget(widget_id, new_body, revision+1)
  └─ emits widget.updated
```

### `repeat_widget` flow (re-roll)

```
repeat_widget(widget_id, feedback?)
  │
  ├─ widget = doc.widgets[widget_id]
  │    Precondition: widget.fused_tool_id is not None AND widget.composed is False.
  │    Otherwise → ToolError(code="invalid_input", message="repeat is only valid
  │    on un-composed fused-tool widgets", retryable=false).
  ├─ append widget.current_numbers to widget.rejected_attempts
  ├─ template = registry.get_fused(widget.fused_tool_id)
  ├─ run_fused_tool with prior=widget, instruction=feedback, and rejected_attempts in the prompt
  │    Per-param minimum-distance constraints injected from rejected log to prevent convergence.
  ├─ doc.update_widget(widget_id, new_body, revision+1)
  └─ emits widget.updated
```

### `delete_widget` flow (dismiss + suppress)

```
delete_widget(widget_id, suppress_similar=True)
  │
  ├─ widget.status = "dismissed"
  ├─ if suppress_similar:
  │    doc.dismissals.append(DismissalRule(
  │      intent_norm = normalise(widget.intent),
  │      scope_signature = fingerprint(widget.scope),
  │      fused_tool_id = widget.fused_tool_id,
  │    ))
  ├─ emits widget.deleted + dismissal.added
  └─ ack
```

`restore_widget` undoes both (status flip + dismissal revoke).

---

## State stream + frontend integration

### New endpoints

```
GET /api/state/{session_id}                 # one-shot SessionStateSnapshot
GET /api/state/{session_id}/events          # SSE stream of StateEvent
```

```python
class SessionStateSnapshot(BaseModel):
    session_id: str
    image_context: EnrichedImageContext
    widgets: list[Widget]                          # includes dismissed; filtered client-side
    masks_index: list[MaskSummary]                 # id + bbox + thumbnail data URL
    operation_graph: OperationGraph                # server-projected
    revision: int

class StateEvent(BaseModel):
    revision: int
    kind: Literal["widget.created", "widget.updated", "widget.deleted",
                  "widget.accepted", "widget.restored",
                  "mask.created", "selection.changed",
                  "context.updated", "dismissal.added"]
    payload: dict
```

### Frontend mental model

```
boot → POST /api/tools/create_session (or POST /session)
     → POST /api/tools/analyze_image          (returns context + autonomous suggestions)
     → GET  /api/state/{sid}                  (initial snapshot)
     → open SSE on /api/state/{sid}/events    (live stream)

user drags slider:
     → POST /api/tools/set_widget_param       (REST-only; optimistic local update, server emits widget.updated)

user types in command palette:
     → POST /api/tools/propose_widget         (server emits widget.created on success)

external Claude over MCP does anything:
     → SSE event arrives, frontend renders identically
```

### State slice replacement

A `BackendStateSlice` becomes the single source of truth for widget/mask/projection state. Today's `useEditorStore.layers` (adjustments), AI-panel widget array, and `committedMaskRef`/`activeMaskRef` are removed in favour of selectors over `snapshot`. Viewport/zoom/active-tool/document-meta slices stay client-only.

### Preview renderer

`preview_widget` calls `state/preview_renderer.py`, a CPU approximation of the WebGL pipeline using numpy/OpenCV. Faithful enough for 256-px thumbnails for `kelvin`, `basic`, `curves`, `levels`. `lut` and complex filters fall back to `kind: "none"` (no preview rendered) rather than producing a wrong preview.

### Backward-compat shims

`/api/panel` stays for two milestones, internally calls `propose_widget(intent=user_goal, scope=global, fused_tool_id=None)` and returns the current projection. Same for `/api/refine` → `refine_widget` with `instruction` set, no `edits`/`additions`. Both shims include a `Deprecation` response header.

---

## Error handling

Uniform envelope at the registry boundary:

```python
class ToolResponseEnvelope(BaseModel):
    ok: bool
    output: dict | None = None
    error: ToolError | None = None

class ToolError(BaseModel):
    code: ErrorCode
    message: str
    retryable: bool
    recovery_hint: str | None
    details: dict | None

ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]
```

Failure sources and behaviour:

1. **Input validation** (Pydantic) → `invalid_input` with `details.field_paths`. Handler not invoked.
2. **Precondition checks** (`requires_image`, `requires_context`) → `missing_image` / `missing_context`. Retryable with a recovery hint.
3. **Fused-tool resolver** → three nested mechanisms inside `run_fused_tool`:
   - Validation fail → up to 3 retries with `last_error` in the prompt.
   - Envelope violation → clamp + one retry with the clamp note.
   - Triple-miss → deterministic seed (envelope midpoints) + WARN log. Never throws.
4. **SAM** → empty mask returns `sam_failed`.
5. **Scope** → `scope_unresolvable` with a hint to call `select_*` first.

Skin safety:

- `requires_scope="skin_safe"` + skin scope → envelope `skin_safe_max` engages automatically. No error. Binding `reasoning` includes the constraint note.
- Non-skin-safe template + skin scope → `skin_safety_violation, retryable=false`. Hard fail with a recovery hint suggesting `portrait_glow` or global scope.

Concurrent edits:

- Per-session write lock inside `registry.invoke()`. Mutations serialise; queries don't take it. Granularity is per session_id (no global lock).
- `StateEvent.revision` monotonic per session. Optimistic frontend updates carry the snapshot revision they were based on; lower-revision events from server are dropped; higher applied. Same-revision conflict → server wins.

MCP transport:

- Unpaired session → 401 at transport, before registry.
- SSE disconnect during long-running tool → call still completes; result held briefly for reconnect fetch.
- Per-MCP-session rate limit: default 30 tool calls / minute. Returns `transport_error, retryable=true` with `Retry-After`.

---

## Testing strategy

### Tier 1 — Unit tests

- `schemas/*`: Pydantic round-trips, discriminated-union coverage.
- `tools/fused/<id>.py`: one test file per fused tool; mock `AnthropicClient`. Assert (a) skeleton fixed across calls, (b) tunables inside `param_envelope`, (c) skin-safe engagement on skin scope, (d) prior/instruction flow into resolver prompts.
- `tools/registry.py`: register/lookup, transport filtering, invoke flow with validation errors.
- `state/document.py`: add/update/dismiss widgets, projection determinism, event-ordering invariants.

### Tier 2 — Tool-handler integration

For each MCP tool, one test using in-memory `SessionStore`, fake `AnthropicClient` (canned), fake `SamClient` (deterministic masks). Files like:

```
tests/tools/test_propose_widget.py
tests/tools/test_refine_widget.py
tests/tools/test_repeat_widget.py
tests/tools/test_delete_widget.py
tests/tools/test_select_named_region.py
…
```

The fake `AnthropicClient` is fixture-driven: each Claude call's expected request is matched against a recorded golden; the response is canned JSON. New fused tools ship with their golden.

### Tier 3 — End-to-end MCP loop

`tests/mcp/test_e2e_loop.py`:

1. Spin up FastAPI in a fixture (`httpx.AsyncClient`).
2. Speak MCP over streamable HTTP to `/mcp` (real wire format).
3. Walk: `create_session` → `analyze_image` (fixture image + fake Claude) → `list_fused_tools` → `propose_widget(intent="warmer")` → `refine_widget(...)` → `repeat_widget(...)` → `delete_widget(...)`. Assert SSE event sequence and final document state.

Gated behind `--run-e2e` in default CI; runs nightly.

### Tier 4 — Image-context regression

Bundle 5–10 reference photos in `tests/fixtures/images/`. For each, snapshot the cheap-pass `EnrichedImageContext` JSON. Subsequent runs must match (float tolerance). Catches silent stats regressions that would shift fused-tool behaviour.

### Out of scope for tests

- Real Anthropic API (cost; fakes only).
- Frontend render output (covered by existing frontend tests).
- WebGL pipeline (unchanged).
- Real SAM decode quality (covered by existing backend tests).

---

## Out-of-scope for this spec (future work)

- Frontend implementation of the `BackendStateSlice` and the SSE subscriber. Tracked separately.
- Migration of existing frontend `tool-manifest` consumers off Zustand into the new SSE-driven slice.
- Multi-user collaboration / CRDT. Not needed for thesis prototype.
- Full WebGL parity for `preview_widget`. CPU approximation is sufficient.
- Focus map / sharpness score / face landmarks. Deferred to v3.
- Brush primitives over MCP. Bitmap brushwork stays a human pointing-device action.

---

## Glossary

- **Widget** — composite UI unit with id, intent, scope, ordered controls, and a node-graph fragment.
- **Fused tool** — Python template declaring a fixed node-graph skeleton + fixed binding skeleton + tunable-parameter envelope; resolved per image via Claude.
- **Skeleton** — the immutable structural part of a fused tool (nodes + bindings, minus their numeric values).
- **Envelope** — per-parameter `(min, max, step, skin_safe_max?)` clamp applied by the framework on every resolver output.
- **Projection** — pure function `widgets → OperationGraph`. Run server-side, included in every snapshot and event payload.
- **Cheap pass** — deterministic statistics computed locally during `analyze_image` (no LLM).
- **Autonomous suggestion** — widgets minted by the post-analyze pass from `problems[]`. Land in suggestions tray; require `accept_widget` to activate.
- **Composition edit** — a `refine_widget` call that changes the binding set (keep/remove/add). Sets `widget.composed=true` and graduates the widget out of pure fused-tool mode.
- **Re-roll** — a `repeat_widget` call that re-resolves the same template with the prior numbers in the rejection log.
- **Dismissal rule** — `(intent_norm, scope_signature, fused_tool_id)` triple added to `SessionDocument.dismissals` by a `delete_widget` call. Suppresses matching autonomous suggestions.
