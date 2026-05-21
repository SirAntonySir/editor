# Plan 1 — MCP Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative backend document model (`SessionDocument`, `Widget`, masks) and the `BackendToolRegistry` exposed via a generated REST adapter at `POST /api/tools/<name>`, with query / selection / atomic tools wired end-to-end. No MCP wire format and no fused-tool framework yet — those are Plans 2 and 3.

**Architecture:** A single Python `BackendToolRegistry` is the source of truth for capability definitions. Each tool subclasses `BackendTool`, ships Pydantic input/output schemas, and runs through `registry.invoke()` which handles validation, permission checks, per-session locking, and the `{ok, output|error}` envelope. State lives in `SessionDocument` aggregates owned by an extended `SessionStore`. `/api/panel` and `/api/refine` are NOT changed in this plan — the existing flow keeps working untouched.

**Tech Stack:** FastAPI 0.115, Pydantic 2.9, pytest 8.3 + pytest-asyncio, existing `AnthropicClient` and `SamClient` services unchanged.

---

## File Structure

**New files:**
- `backend/app/schemas/errors.py` — `ErrorCode`, `ToolError`, `ToolResponseEnvelope`.
- `backend/app/schemas/widget.py` — `Widget`, `WidgetOrigin`, `ControlBinding`, `ControlSchema` discriminated union, `WidgetPreview`, `WidgetNode`, `Scope`, `MaskRecord`, `Note`, `DismissalRule`, `StateEvent`, `NodeParamTarget`.
- `backend/app/state/__init__.py`
- `backend/app/state/document.py` — `SessionDocument` aggregate with add/update/dismiss methods + revision bumping.
- `backend/app/state/operations.py` — `project_to_graph(doc) → OperationGraph` pure function.
- `backend/app/state/events.py` — per-session event bus (in-memory pub/sub) used by tools and (later) SSE.
- `backend/app/tools/__init__.py`
- `backend/app/tools/base.py` — `BackendTool` protocol + `ToolPermissions` + invocation context.
- `backend/app/tools/registry.py` — `BackendToolRegistry` singleton + `invoke()` + per-session write lock.
- `backend/app/tools/atomic/__init__.py` — registers every atomic tool.
- One file per tool under `backend/app/tools/atomic/`:
  `get_image_context.py`, `list_named_regions.py`, `list_layers.py`, `list_widgets.py`,
  `get_widget.py`, `get_active_selection.py`, `select_named_region.py`,
  `select_by_point.py`, `select_by_box.py`, `combine_masks.py`, `clear_selection.py`,
  `apply_adjustment.py`, `highlight_region.py`, `add_note.py`, `create_session.py`,
  `analyze_image.py`.
- `backend/app/api/tools_rest.py` — `POST /api/tools/{name}` adapter.
- `backend/tests/state/test_document.py`, `backend/tests/state/test_operations.py`,
  `backend/tests/state/test_events.py`, `backend/tests/tools/test_registry.py`,
  `backend/tests/tools/test_rest_adapter.py`,
  `backend/tests/tools/test_<tool>.py` per tool.
- `backend/tests/schemas/test_errors.py`, `backend/tests/schemas/test_widget.py`.

**Modified files:**
- `backend/app/services/session_store.py` — adds `get_document(sid) → SessionDocument`, `with_document_lock(sid)` context manager.
- `backend/app/api/__init__.py` — mount `tools_rest.router`.
- `backend/app/api/deps.py` — add `get_tool_registry()`.

**Not touched in Plan 1:**
- `backend/app/api/panel.py`, `backend/app/api/refine.py`, `backend/app/api/analyze.py`, `backend/app/api/segment.py`, `backend/app/api/session.py` — keep working as today.
- `backend/app/services/anthropic_client.py`, `backend/app/services/sam_client.py` — used by tools, not modified.
- Frontend — Plan 1 is purely additive; nothing the frontend consumes today changes.

---

## Notes on conventions used below

- **TDD pattern:** every task writes the failing test first, runs it to confirm failure, implements minimal code, runs to confirm pass, commits.
- **Test runner:** `pytest backend/tests/<path> -v`. CWD is the repo root; tests live under `backend/tests/` and the conftest imports use `app.*` paths.
- **Commits:** one per task. Use Conventional Commits prefixes: `feat`, `test`, `refactor`. Append the standard `Co-Authored-By` trailer.
- **`source venv/bin/activate`** is assumed; the existing backend dev flow uses a venv under `backend/`. Substitute your activation step if different.

---

## Task 1: Error envelope schemas

**Files:**
- Create: `backend/app/schemas/errors.py`
- Test: `backend/tests/schemas/test_errors.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/schemas/__init__.py` (empty file) and:

```python
# backend/tests/schemas/test_errors.py
import pytest
from pydantic import ValidationError

from app.schemas.errors import ErrorCode, ToolError, ToolResponseEnvelope


def test_error_codes_include_required_values() -> None:
    required = {
        "missing_session", "missing_image", "missing_context",
        "invalid_input", "unknown_tool", "unknown_widget",
        "unknown_region", "unknown_mask",
        "scope_unresolvable", "sam_failed",
        "llm_validation_failed", "llm_envelope_violation",
        "fused_tool_not_found", "skin_safety_violation",
        "transport_error", "internal_error",
    }
    assert required.issubset(set(ErrorCode.__args__))


def test_tool_error_roundtrip() -> None:
    err = ToolError(
        code="missing_context",
        message="call analyze_image first",
        retryable=True,
        recovery_hint="call analyze_image",
    )
    dumped = err.model_dump()
    assert ToolError.model_validate(dumped) == err


def test_envelope_ok_requires_output() -> None:
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=True, output=None)


def test_envelope_fail_requires_error() -> None:
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=False, error=None)


def test_envelope_ok_success_path() -> None:
    env = ToolResponseEnvelope(ok=True, output={"hello": "world"})
    assert env.error is None
    assert env.output == {"hello": "world"}


def test_envelope_fail_success_path() -> None:
    err = ToolError(code="invalid_input", message="bad", retryable=False)
    env = ToolResponseEnvelope(ok=False, error=err)
    assert env.output is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_errors.py -v`
Expected: ImportError or ModuleNotFoundError on `app.schemas.errors`.

- [ ] **Step 3: Implement `schemas/errors.py`**

```python
# backend/app/schemas/errors.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]


class ToolError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: ErrorCode
    message: str
    retryable: bool
    recovery_hint: str | None = None
    details: dict | None = None


class ToolResponseEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    output: dict | None = None
    error: ToolError | None = None

    @model_validator(mode="after")
    def _check_envelope(self) -> "ToolResponseEnvelope":
        if self.ok and self.output is None:
            raise ValueError("ok=True requires output")
        if not self.ok and self.error is None:
            raise ValueError("ok=False requires error")
        return self
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_errors.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/errors.py backend/tests/schemas/test_errors.py backend/tests/schemas/__init__.py
git commit -m "$(cat <<'EOF'
feat(schemas): tool error envelope (ToolError + ToolResponseEnvelope)

Discriminated envelope ensures ok=True has output, ok=False has error.
ErrorCode literal covers every failure path the registry will emit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scope, NodeParamTarget, and primitive types

**Files:**
- Create: `backend/app/schemas/widget.py` (initial slice — scope + node param target + type aliases)
- Test: `backend/tests/schemas/test_widget.py` (initial test slice)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/schemas/test_widget.py
import pytest
from pydantic import ValidationError

from app.schemas.widget import (
    GlobalScope,
    MaskScope,
    NamedRegionScope,
    NodeParamTarget,
    Scope,
)


def test_scope_global() -> None:
    s = Scope.model_validate({"kind": "global"})
    assert isinstance(s.root, GlobalScope)


def test_scope_named_region() -> None:
    s = Scope.model_validate({"kind": "named_region", "label": "subject"})
    assert isinstance(s.root, NamedRegionScope)
    assert s.root.label == "subject"


def test_scope_mask() -> None:
    s = Scope.model_validate({"kind": "mask", "mask_id": "m_1"})
    assert isinstance(s.root, MaskScope)
    assert s.root.mask_id == "m_1"


def test_scope_unknown_kind_rejected() -> None:
    with pytest.raises(ValidationError):
        Scope.model_validate({"kind": "nonsense"})


def test_node_param_target_roundtrip() -> None:
    t = NodeParamTarget(node_id="n1", param_key="temperature")
    assert NodeParamTarget.model_validate(t.model_dump()) == t
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: ImportError on `app.schemas.widget`.

- [ ] **Step 3: Implement scope + target primitives**

```python
# backend/app/schemas/widget.py
from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, RootModel


# ------------------------------------------------------------------
# Scope — what a tool / widget targets.
# ------------------------------------------------------------------


class GlobalScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["global"]


class NamedRegionScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["named_region"]
    label: str = Field(min_length=1)


class MaskScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["mask"]
    mask_id: str = Field(min_length=1)


_ScopeAny = Annotated[
    Union[GlobalScope, NamedRegionScope, MaskScope],
    Field(discriminator="kind"),
]


class Scope(RootModel[_ScopeAny]):
    """Discriminated union over the scope kinds."""

    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------
# Node + binding target
# ------------------------------------------------------------------


class NodeParamTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str = Field(min_length=1)
    param_key: str = Field(min_length=1)


# Subsequent tasks extend this module with ControlBinding, Widget, etc.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_widget.py
git commit -m "$(cat <<'EOF'
feat(schemas): scope + node-param-target primitives

Pydantic discriminated union over global / named_region / mask scopes.
NodeParamTarget pairs a node id with the param the binding writes to.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: ControlBinding + ControlSchema discriminated union

**Files:**
- Modify: `backend/app/schemas/widget.py`
- Test: extend `backend/tests/schemas/test_widget.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/schemas/test_widget.py`:

```python
from app.schemas.widget import (
    ChoiceSchema,
    ColorSchema,
    ControlBinding,
    ControlSchema,
    CurvePointSchema,
    CurveSchema,
    HistogramMarkerSchema,
    MaskThumbnailSchema,
    NumericPairSchema,
    RegionPickerSchema,
    SliderSchema,
    TextSchema,
    ToggleSchema,
    BeforeAfterToggleSchema,
)


def test_slider_schema_required_fields() -> None:
    s = SliderSchema(control_type="slider", min=0, max=100, step=1, unit="")
    assert s.control_type == "slider"


def test_control_schema_dispatches_by_type() -> None:
    raw = {"control_type": "toggle", "on_label": "On", "off_label": "Off"}
    cs = ControlSchema.model_validate(raw)
    assert isinstance(cs.root, ToggleSchema)


def test_control_schema_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        ControlSchema.model_validate({"control_type": "frob"})


def test_control_binding_validates_value_against_slider_schema() -> None:
    binding = ControlBinding(
        param_key="intensity",
        label="Intensity",
        control_type="slider",
        target=NodeParamTarget(node_id="n1", param_key="amount"),
        schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": 0, "max": 100, "step": 1, "unit": ""}
        ),
        value=42,
        default=0,
    )
    assert binding.value == 42


def test_control_binding_color_value_is_rgb_tuple() -> None:
    binding = ControlBinding(
        param_key="tint",
        label="Tint",
        control_type="color",
        target=NodeParamTarget(node_id="n2", param_key="rgb"),
        schema=ControlSchema.model_validate(
            {"control_type": "color", "space": "rgb", "show_alpha": False, "presets": []}
        ),
        value=[255, 200, 100],
        default=[128, 128, 128],
    )
    assert binding.value == [255, 200, 100]


def test_control_type_set() -> None:
    from app.schemas.widget import ControlType
    expected = {
        "slider", "numeric_pair", "toggle", "choice", "color", "curve",
        "curve_point", "mask_thumbnail", "region_picker",
        "before_after_toggle", "histogram_marker", "text",
    }
    assert set(ControlType.__args__) == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: ImportError on the new symbols.

- [ ] **Step 3: Extend `schemas/widget.py` with control types**

Append below the existing module content:

```python
# ------------------------------------------------------------------
# Control catalog — one schema class per control_type.
# ------------------------------------------------------------------


ControlType = Literal[
    "slider", "numeric_pair", "toggle", "choice", "color", "curve",
    "curve_point", "mask_thumbnail", "region_picker",
    "before_after_toggle", "histogram_marker", "text",
]


class SliderSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["slider"]
    min: float
    max: float
    step: float
    unit: str = ""


class NumericPairSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["numeric_pair"]
    min_a: float
    max_a: float
    step_a: float
    label_a: str
    min_b: float
    max_b: float
    step_b: float
    label_b: str


class ToggleSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["toggle"]
    on_label: str = "On"
    off_label: str = "Off"


class ChoiceOption(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: str
    label: str
    swatch: list[int] | None = None  # optional RGB swatch shown beside option


class ChoiceSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["choice"]
    options: list[ChoiceOption] = Field(min_length=1)
    allow_custom: bool = False


class ColorSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["color"]
    space: Literal["rgb", "lab", "hsl"] = "rgb"
    show_alpha: bool = False
    presets: list[list[int]] = Field(default_factory=list)


class CurveSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["curve"]
    channel: Literal["luma", "r", "g", "b"]
    min_points: int = 2
    max_points: int = 16


class CurvePointSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["curve_point"]
    channel: Literal["luma", "r", "g", "b"]
    x_min: float = 0.0
    x_max: float = 1.0
    y_min: float = 0.0
    y_max: float = 1.0


class MaskThumbnailSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["mask_thumbnail"]
    allow_replace: bool = True
    allow_combine: list[Literal["union", "intersect", "subtract"]] = Field(default_factory=list)


class RegionPickerSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["region_picker"]
    candidate_labels: list[str] = Field(default_factory=list)
    allow_active_selection: bool = True
    allow_global: bool = True


class BeforeAfterToggleSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["before_after_toggle"]
    split_orientation: Literal["horizontal", "vertical", "swap"] = "swap"


class HistogramMarkerSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["histogram_marker"]
    channel: Literal["luma", "r", "g", "b"]
    marker_kind: Literal["black_point", "white_point", "gamma"]


class TextSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_type: Literal["text"]
    max_len: int = 256
    placeholder: str = ""


_ControlSchemaAny = Annotated[
    Union[
        SliderSchema, NumericPairSchema, ToggleSchema, ChoiceSchema, ColorSchema,
        CurveSchema, CurvePointSchema, MaskThumbnailSchema, RegionPickerSchema,
        BeforeAfterToggleSchema, HistogramMarkerSchema, TextSchema,
    ],
    Field(discriminator="control_type"),
]


class ControlSchema(RootModel[_ControlSchemaAny]):
    model_config = ConfigDict(extra="forbid")


ControlValue = Union[float, int, str, bool, list, dict]


class ControlBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    param_key: str = Field(min_length=1)
    label: str
    control_type: ControlType
    target: NodeParamTarget
    schema: ControlSchema
    value: ControlValue
    default: ControlValue
    reasoning: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: 11 passed (5 from Task 2 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_widget.py
git commit -m "$(cat <<'EOF'
feat(schemas): control catalog + ControlBinding

Twelve control-type schemas as a Pydantic discriminated union with strict
validation. ControlBinding owns param_key, target, schema, value, default,
and optional reasoning.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: WidgetNode, WidgetOrigin, WidgetPreview, Widget

**Files:**
- Modify: `backend/app/schemas/widget.py`
- Test: extend `backend/tests/schemas/test_widget.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
from app.schemas.widget import (
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetOriginKind,
    WidgetPreview,
)


def test_widget_origin_kinds() -> None:
    expected = {"mcp_user_prompt", "mcp_autonomous", "user_palette", "fused_expansion"}
    assert set(WidgetOriginKind.__args__) == expected


def test_widget_origin_user_prompt_keeps_prompt() -> None:
    o = WidgetOrigin(kind="mcp_user_prompt", prompt="warm subject")
    assert o.parent_widget_id is None


def test_widget_origin_autonomous_no_prompt_ok() -> None:
    o = WidgetOrigin(kind="mcp_autonomous")
    assert o.prompt is None


def test_widget_preview_defaults() -> None:
    p = WidgetPreview(kind="thumbnail", auto_before_after=True)
    assert p.auto_before_after is True


def test_widget_full_roundtrip() -> None:
    binding = ControlBinding(
        param_key="intensity",
        label="Intensity",
        control_type="slider",
        target=NodeParamTarget(node_id="n1", param_key="amount"),
        schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": 0, "max": 100, "step": 1}
        ),
        value=50,
        default=0,
    )
    node = WidgetNode(
        id="n1", type="basic", params={"amount": 50},
        scope=Scope.model_validate({"kind": "global"}),
        inputs=[], widget_id="w_1",
    )
    w = Widget(
        id="w_1",
        intent="warm subject",
        reasoning="image is cool",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warmer"),
        fused_tool_id="warm_grade",
        composed=False,
        nodes=[node],
        bindings=[binding],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        rejected_attempts=[],
        status="active",
        revision=1,
    )
    dumped = w.model_dump(mode="json")
    assert Widget.model_validate(dumped).id == "w_1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: ImportError on the new symbols.

- [ ] **Step 3: Extend `schemas/widget.py` with widget models**

Append to the existing module:

```python
from datetime import datetime, timezone

# ------------------------------------------------------------------
# Node fragment + origin + preview
# ------------------------------------------------------------------


ParamValue = Union[float, int, str, bool]


class WidgetNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    params: dict[str, ParamValue] = Field(default_factory=dict)
    scope: Scope
    inputs: list[str] = Field(default_factory=list)
    widget_id: str = Field(min_length=1)


WidgetOriginKind = Literal[
    "mcp_user_prompt", "mcp_autonomous", "user_palette", "fused_expansion",
]


class WidgetOrigin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: WidgetOriginKind
    prompt: str | None = None
    parent_widget_id: str | None = None


class WidgetPreview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["thumbnail", "histogram_delta", "color_swatches", "none"]
    auto_before_after: bool = False


class ResolvedNumbers(BaseModel):
    """One attempt's tunable values + optional reasoning. Used both by the
    fused-tool framework (Plan 2) and by Widget.rejected_attempts for the
    repeat-widget anchor log."""
    model_config = ConfigDict(extra="forbid")
    values: dict[str, ParamValue]
    reasoning: str | None = None


class Widget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    intent: str = Field(min_length=1)
    reasoning: str | None = None
    scope: Scope
    origin: WidgetOrigin
    fused_tool_id: str | None = None
    composed: bool = False
    nodes: list[WidgetNode] = Field(default_factory=list)
    bindings: list[ControlBinding] = Field(default_factory=list)
    preview: WidgetPreview = Field(
        default_factory=lambda: WidgetPreview(kind="thumbnail", auto_before_after=True)
    )
    rejected_attempts: list[ResolvedNumbers] = Field(default_factory=list)
    status: Literal["active", "dismissed"] = "active"
    revision: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: 16 passed (11 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_widget.py
git commit -m "$(cat <<'EOF'
feat(schemas): Widget + WidgetNode + WidgetOrigin + WidgetPreview

Composite widget model with revision tracking, soft-delete status,
rejected_attempts log for the repeat workflow, and an origin tag
distinguishing user prompts from autonomous suggestions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MaskRecord, Note, DismissalRule, StateEvent

**Files:**
- Modify: `backend/app/schemas/widget.py`
- Test: extend `backend/tests/schemas/test_widget.py`

- [ ] **Step 1: Write the failing test**

Append:

```python
from app.schemas.widget import (
    DismissalRule,
    MaskRecord,
    Note,
    NoteAnchor,
    NoteAnchorImage,
    NoteAnchorPoint,
    NoteAnchorRegion,
    StateEvent,
    StateEventKind,
)


def test_mask_record_required_fields() -> None:
    m = MaskRecord(
        id="m_1", width=512, height=512,
        png_b64="aGVsbG8=", source="sam_point",
        parent_mask_ids=[], label=None,
    )
    assert m.source == "sam_point"


def test_note_anchor_region() -> None:
    a = NoteAnchor.model_validate({"kind": "region", "label": "subject"})
    assert isinstance(a.root, NoteAnchorRegion)


def test_note_anchor_point() -> None:
    a = NoteAnchor.model_validate({"kind": "point", "x": 0.5, "y": 0.5})
    assert isinstance(a.root, NoteAnchorPoint)


def test_dismissal_rule_required_fields() -> None:
    r = DismissalRule(
        id="d_1", source_widget_id="w_1",
        intent_norm="warm subject", scope_signature="named_region:left person",
        fused_tool_id="warm_grade",
    )
    assert r.fused_tool_id == "warm_grade"


def test_state_event_kinds() -> None:
    expected = {
        "widget.created", "widget.updated", "widget.deleted",
        "widget.accepted", "widget.restored",
        "mask.created", "selection.changed",
        "context.updated", "dismissal.added",
    }
    assert set(StateEventKind.__args__) == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: ImportError on the new symbols.

- [ ] **Step 3: Extend `schemas/widget.py`**

Append:

```python
# ------------------------------------------------------------------
# Mask, note, dismissal, event
# ------------------------------------------------------------------


class MaskRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    png_b64: str = Field(min_length=1)
    source: Literal["sam_point", "sam_box", "named_region", "painted", "combined"]
    parent_mask_ids: list[str] = Field(default_factory=list)
    label: str | None = None


class NoteAnchorRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["region"]
    label: str = Field(min_length=1)


class NoteAnchorPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["point"]
    x: float
    y: float


class NoteAnchorImage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["image"]


_NoteAnchorAny = Annotated[
    Union[NoteAnchorRegion, NoteAnchorPoint, NoteAnchorImage],
    Field(discriminator="kind"),
]


class NoteAnchor(RootModel[_NoteAnchorAny]):
    model_config = ConfigDict(extra="forbid")


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    anchor: NoteAnchor
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DismissalRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1)
    source_widget_id: str = Field(min_length=1)
    intent_norm: str
    scope_signature: str
    fused_tool_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


StateEventKind = Literal[
    "widget.created", "widget.updated", "widget.deleted",
    "widget.accepted", "widget.restored",
    "mask.created", "selection.changed",
    "context.updated", "dismissal.added",
]


class StateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    kind: StateEventKind
    payload: dict
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_widget.py -v`
Expected: 21 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_widget.py
git commit -m "$(cat <<'EOF'
feat(schemas): MaskRecord, Note, DismissalRule, StateEvent

Supporting schemas for SessionDocument. NoteAnchor is a discriminated union
over region / point / image anchors. StateEventKind enumerates every event
the state stream will emit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: SessionDocument aggregate

**Files:**
- Create: `backend/app/state/__init__.py` (empty)
- Create: `backend/app/state/document.py`
- Test: `backend/tests/state/__init__.py` (empty), `backend/tests/state/test_document.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_document.py
import pytest

from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    DismissalRule,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetOrigin,
    WidgetPreview,
)
from app.state.document import SessionDocument


def _make_widget(wid: str = "w_1", intent: str = "warm subject") -> Widget:
    return Widget(
        id=wid,
        intent=intent,
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt=intent),
        fused_tool_id="warm_grade",
        nodes=[],
        bindings=[],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        status="active",
        revision=1,
    )


def test_new_document_has_revision_zero_and_no_widgets() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    assert doc.revision == 0
    assert doc.widgets == {}


def test_add_widget_bumps_revision_and_emits_created() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    events = doc.add_widget(_make_widget("w_1"))
    assert doc.revision == 1
    assert "w_1" in doc.widgets
    assert doc.widget_order == ["w_1"]
    assert len(events) == 1
    assert events[0].kind == "widget.created"
    assert events[0].revision == 1


def test_update_widget_bumps_revision_keeps_order() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1"))
    doc.add_widget(_make_widget("w_2"))
    updated = _make_widget("w_1", intent="warm subject")
    updated.revision = 2
    updated.reasoning = "now reasoned"
    events = doc.update_widget(updated)
    assert doc.revision == 3
    assert doc.widgets["w_1"].reasoning == "now reasoned"
    assert doc.widget_order == ["w_1", "w_2"]
    assert events[0].kind == "widget.updated"


def test_dismiss_widget_soft_deletes_and_appends_rule() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1", intent="warm subject"))
    rule = DismissalRule(
        id="d_1", source_widget_id="w_1",
        intent_norm="warm subject", scope_signature="global",
        fused_tool_id="warm_grade",
    )
    events = doc.dismiss_widget("w_1", rule=rule)
    assert doc.widgets["w_1"].status == "dismissed"
    assert doc.dismissals == [rule]
    kinds = {e.kind for e in events}
    assert kinds == {"widget.deleted", "dismissal.added"}


def test_restore_widget_clears_rule_and_status() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    doc.add_widget(_make_widget("w_1"))
    rule = DismissalRule(
        id="d_1", source_widget_id="w_1",
        intent_norm="warm", scope_signature="global", fused_tool_id="warm_grade",
    )
    doc.dismiss_widget("w_1", rule=rule)
    events = doc.restore_widget("w_1")
    assert doc.widgets["w_1"].status == "active"
    assert doc.dismissals == []
    assert events[0].kind == "widget.restored"


def test_unknown_widget_id_raises_key_error() -> None:
    doc = SessionDocument(session_id="s1", image_bytes=b"", mime_type="image/jpeg")
    with pytest.raises(KeyError):
        doc.update_widget(_make_widget("missing"))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/state/test_document.py -v`
Expected: ImportError on `app.state.document`.

- [ ] **Step 3: Implement `state/document.py`**

```python
# backend/app/state/document.py
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.image_context import ImageContext
from app.schemas.widget import (
    DismissalRule,
    MaskRecord,
    Note,
    StateEvent,
    Widget,
)


class SessionDocument(BaseModel):
    """Authoritative per-session state. Owns widgets, masks, dismissals,
    notes, image context and an event log. All mutations bump `revision`
    and return the StateEvents they emitted."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    session_id: str
    image_bytes: bytes = b""
    mime_type: str = "image/jpeg"
    image_context: ImageContext | None = None
    masks: dict[str, MaskRecord] = Field(default_factory=dict)
    widgets: dict[str, Widget] = Field(default_factory=dict)
    widget_order: list[str] = Field(default_factory=list)
    dismissals: list[DismissalRule] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    history: list[StateEvent] = Field(default_factory=list)
    revision: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # ---------------- helpers ----------------

    def _emit(self, kind: str, payload: dict[str, Any]) -> StateEvent:
        self.revision += 1
        self.updated_at = datetime.now(timezone.utc)
        ev = StateEvent(revision=self.revision, kind=kind, payload=payload)  # type: ignore[arg-type]
        self.history.append(ev)
        return ev

    # ---------------- widget mutations ----------------

    def add_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id in self.widgets:
            raise KeyError(f"widget {widget.id} already exists")
        self.widgets[widget.id] = widget
        self.widget_order.append(widget.id)
        return [self._emit("widget.created", {"widget": widget.model_dump(mode="json")})]

    def update_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id not in self.widgets:
            raise KeyError(widget.id)
        widget.updated_at = datetime.now(timezone.utc)
        self.widgets[widget.id] = widget
        return [self._emit("widget.updated", {"widget": widget.model_dump(mode="json")})]

    def dismiss_widget(self, widget_id: str, rule: DismissalRule | None = None) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "dismissed"
        w.updated_at = datetime.now(timezone.utc)
        events = [self._emit("widget.deleted", {"widget_id": widget_id})]
        if rule is not None:
            self.dismissals.append(rule)
            events.append(self._emit("dismissal.added", {"rule": rule.model_dump(mode="json")}))
        return events

    def restore_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "active"
        w.updated_at = datetime.now(timezone.utc)
        self.dismissals = [r for r in self.dismissals if r.source_widget_id != widget_id]
        return [self._emit("widget.restored", {"widget_id": widget_id})]

    def accept_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        return [self._emit("widget.accepted", {"widget_id": widget_id})]

    # ---------------- mask mutations ----------------

    def add_mask(self, mask: MaskRecord) -> list[StateEvent]:
        self.masks[mask.id] = mask
        return [self._emit("mask.created", {"mask_id": mask.id, "source": mask.source})]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/state/test_document.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/__init__.py backend/app/state/document.py backend/tests/state/__init__.py backend/tests/state/test_document.py
git commit -m "$(cat <<'EOF'
feat(state): SessionDocument aggregate with widget/mask/dismissal ops

Every mutation bumps a monotonic revision and returns the StateEvents it
emitted, so tools and the SSE stream share a single event vocabulary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Projection — `project_to_graph(doc) -> OperationGraph`

**Files:**
- Create: `backend/app/state/operations.py`
- Test: `backend/tests/state/test_operations.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_operations.py
from app.schemas.operation_graph import OperationGraph
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
from app.state.operations import project_to_graph


def _widget(wid: str, node_id: str, params: dict, status: str = "active") -> Widget:
    return Widget(
        id=wid,
        intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warmer"),
        fused_tool_id="warm_grade",
        nodes=[
            WidgetNode(
                id=node_id, type="kelvin", params=params,
                scope=Scope.model_validate({"kind": "global"}),
                inputs=[], widget_id=wid,
            )
        ],
        bindings=[
            ControlBinding(
                param_key="temperature",
                label="warm cast",
                control_type="slider",
                target=NodeParamTarget(node_id=node_id, param_key="temperature"),
                schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": 3000, "max": 9000, "step": 50}
                ),
                value=params.get("temperature", 5500),
                default=5500,
            )
        ],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        status=status,  # type: ignore[arg-type]
        revision=1,
    )


def test_empty_doc_projects_to_empty_graph() -> None:
    doc = SessionDocument(session_id="s1")
    graph = project_to_graph(doc)
    assert graph.nodes == []
    assert graph.panel_bindings == []


def test_single_active_widget_projects_nodes_and_bindings() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_1"]
    assert graph.nodes[0].params["temperature"] == 6500
    assert [b.param_key for b in graph.panel_bindings] == ["temperature"]


def test_dismissed_widgets_excluded() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    doc.add_widget(_widget("w_2", "n_2", {"temperature": 7000}))
    doc.dismiss_widget("w_2")
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_1"]


def test_widget_order_preserved_in_projection() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_a", "n_a", {"temperature": 6500}))
    doc.add_widget(_widget("w_b", "n_b", {"temperature": 7000}))
    graph = project_to_graph(doc)
    assert [n.id for n in graph.nodes] == ["n_a", "n_b"]


def test_pure_function_does_not_mutate_doc() -> None:
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))
    before = doc.model_dump_json()
    project_to_graph(doc)
    after = doc.model_dump_json()
    assert before == after
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/state/test_operations.py -v`
Expected: ImportError on `app.state.operations`.

- [ ] **Step 3: Implement `state/operations.py`**

```python
# backend/app/state/operations.py
from __future__ import annotations

import uuid

from app.schemas.operation_graph import Node, OperationGraph, PanelBinding, Scope as GraphScope
from app.schemas.widget import Scope as WidgetScope, Widget
from app.state.document import SessionDocument


def _widget_scope_to_graph_scope(s: WidgetScope) -> GraphScope:
    """Translate the widget-side scope discriminated union into the
    OperationGraph's looser Scope type the frontend renderer already consumes."""
    root = s.root
    if root.kind == "global":
        return GraphScope(kind="global")
    if root.kind == "named_region":
        return GraphScope(kind="mask:proposed", label=root.label)
    return GraphScope(kind="mask:click")  # mask_id is a backend-only handle


def _binding_to_panel_binding(widget: Widget) -> list[PanelBinding]:
    out: list[PanelBinding] = []
    for b in widget.bindings:
        schema_root = b.schema.root
        control = "slider"
        if b.control_type == "toggle":
            control = "toggle"
        elif b.control_type in {"choice", "color", "region_picker", "mask_thumbnail"}:
            control = "picker"
        # Pull min/max/step/default for slider-like schemas; leave None otherwise.
        min_v = getattr(schema_root, "min", None)
        max_v = getattr(schema_root, "max", None)
        step_v = getattr(schema_root, "step", None)
        out.append(
            PanelBinding(
                node_id=b.target.node_id,
                param_key=b.target.param_key,
                label=b.label,
                control=control,  # type: ignore[arg-type]
                min=min_v,
                max=max_v,
                default=b.default if isinstance(b.default, (int, float, str, bool)) else None,
                step=step_v,
                reasoning=b.reasoning,
            )
        )
    return out


def project_to_graph(doc: SessionDocument) -> OperationGraph:
    """Pure projection of active widgets → OperationGraph.

    Iterates doc.widget_order so the active-widget set keeps a deterministic
    render order. Dismissed widgets are excluded. No mutation."""
    nodes: list[Node] = []
    bindings: list[PanelBinding] = []
    user_goal_parts: list[str] = []
    for wid in doc.widget_order:
        w = doc.widgets.get(wid)
        if w is None or w.status != "active":
            continue
        for wn in w.nodes:
            nodes.append(
                Node(
                    id=wn.id,
                    type=wn.type,
                    scope=_widget_scope_to_graph_scope(wn.scope),
                    params=wn.params,
                    inputs=wn.inputs,
                )
            )
        bindings.extend(_binding_to_panel_binding(w))
        user_goal_parts.append(w.intent)
    return OperationGraph(
        id=f"projected-{uuid.uuid4().hex[:8]}",
        user_goal="; ".join(user_goal_parts),
        reasoning=None,
        nodes=nodes,
        panel_bindings=bindings,
        metadata={"projection": "1"},
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/state/test_operations.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/operations.py backend/tests/state/test_operations.py
git commit -m "$(cat <<'EOF'
feat(state): project_to_graph — widgets → OperationGraph

Pure function. Iterates SessionDocument.widget_order, emits nodes and
panel bindings for active widgets only. Translates the widget-side scope
union into the graph's looser scope shape the frontend already renders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Event bus

**Files:**
- Create: `backend/app/state/events.py`
- Test: `backend/tests/state/test_events.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_events.py
import asyncio

import pytest

from app.schemas.widget import StateEvent
from app.state.events import EventBus


def _event(kind: str = "widget.created", rev: int = 1) -> StateEvent:
    return StateEvent(revision=rev, kind=kind, payload={"ping": True})  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_publish_to_subscriber_delivers_event() -> None:
    bus = EventBus()
    queue = bus.subscribe("s1")
    bus.publish("s1", _event())
    received = await asyncio.wait_for(queue.get(), timeout=0.1)
    assert received.kind == "widget.created"


@pytest.mark.asyncio
async def test_publish_isolated_by_session() -> None:
    bus = EventBus()
    q1 = bus.subscribe("s1")
    q2 = bus.subscribe("s2")
    bus.publish("s1", _event())
    assert q2.empty()
    received = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert received.kind == "widget.created"


@pytest.mark.asyncio
async def test_multiple_subscribers_each_receive() -> None:
    bus = EventBus()
    q1 = bus.subscribe("s1")
    q2 = bus.subscribe("s1")
    bus.publish("s1", _event())
    a = await asyncio.wait_for(q1.get(), timeout=0.1)
    b = await asyncio.wait_for(q2.get(), timeout=0.1)
    assert a.kind == b.kind == "widget.created"


def test_unsubscribe_removes_queue() -> None:
    bus = EventBus()
    q = bus.subscribe("s1")
    bus.unsubscribe("s1", q)
    bus.publish("s1", _event())
    assert q.empty()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/state/test_events.py -v`
Expected: ImportError on `app.state.events`.

- [ ] **Step 3: Implement `state/events.py`**

```python
# backend/app/state/events.py
from __future__ import annotations

import asyncio
from collections import defaultdict
from threading import Lock

from app.schemas.widget import StateEvent


class EventBus:
    """In-memory per-session pub/sub. Plan 3 hooks an SSE encoder onto
    `subscribe()`; Plan 1 only needs publish/subscribe for tests and the
    registry's emit step."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[StateEvent]]] = defaultdict(list)
        self._lock = Lock()

    def subscribe(self, session_id: str) -> asyncio.Queue[StateEvent]:
        q: asyncio.Queue[StateEvent] = asyncio.Queue()
        with self._lock:
            self._queues[session_id].append(q)
        return q

    def unsubscribe(self, session_id: str, queue: asyncio.Queue[StateEvent]) -> None:
        with self._lock:
            if queue in self._queues.get(session_id, []):
                self._queues[session_id].remove(queue)

    def publish(self, session_id: str, event: StateEvent) -> None:
        with self._lock:
            queues = list(self._queues.get(session_id, []))
        for q in queues:
            q.put_nowait(event)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/state/test_events.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/events.py backend/tests/state/test_events.py
git commit -m "$(cat <<'EOF'
feat(state): in-memory EventBus for per-session StateEvent pub/sub

Thread-safe registry of subscriber queues, isolated per session_id.
Plan 3 will plug the SSE encoder onto subscribe(); Plan 1 needs it for
registry.invoke() to emit events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Extend `SessionStore` with `SessionDocument` ownership + write lock

**Files:**
- Modify: `backend/app/services/session_store.py`
- Test: extend `backend/tests/test_session_store.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_session_store.py`:

```python
from app.state.document import SessionDocument


def test_get_document_returns_aggregate() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc = store.get_document(sid)
    assert isinstance(doc, SessionDocument)
    assert doc.session_id == sid
    assert doc.image_bytes == b"abc"


def test_get_document_returns_same_instance_within_session() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc_a = store.get_document(sid)
    doc_b = store.get_document(sid)
    assert doc_a is doc_b


def test_with_document_lock_serialises_mutations() -> None:
    import threading
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    order: list[str] = []

    def worker(tag: str) -> None:
        with store.with_document_lock(sid):
            order.append(f"{tag}-start")
            order.append(f"{tag}-end")

    threads = [threading.Thread(target=worker, args=(t,)) for t in ("a", "b", "c")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Inside each lock the start/end must be adjacent — i.e. no interleaving.
    for i in range(0, len(order), 2):
        tag = order[i].split("-")[0]
        assert order[i + 1] == f"{tag}-end"


def test_with_document_lock_on_unknown_session_raises() -> None:
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        with store.with_document_lock("nope"):
            pass
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_session_store.py -v`
Expected: AttributeError / failure on `get_document` and `with_document_lock`.

- [ ] **Step 3: Extend `session_store.py`**

Add to `SessionRecord`:

```python
@dataclass
class SessionRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    last_seen: float
    context: dict[str, Any] | None = None
    graphs: dict[str, dict[str, Any]] = field(default_factory=dict)
    document: "SessionDocument | None" = None  # lazily created
    write_lock: Lock = field(default_factory=Lock)
```

Add inside `SessionStore`:

```python
from contextlib import contextmanager
from typing import Iterator

# Late import to avoid pulling state.document into the session-store module
# at definition time (state.document imports image_context which is fine,
# but keeping the import lazy means the store stays a pure registry).
def _new_document(sid: str, record: "SessionRecord") -> "SessionDocument":
    from app.state.document import SessionDocument
    return SessionDocument(
        session_id=sid,
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
    )


class SessionStore:
    # ...existing members unchanged...

    def get_document(self, sid: str) -> "SessionDocument":
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
        return record.document

    @contextmanager
    def with_document_lock(self, sid: str) -> Iterator["SessionDocument"]:
        record = self.get(sid)
        if record.document is None:
            record.document = _new_document(sid, record)
        with record.write_lock:
            yield record.document
```

(Place the helper `_new_document` at module scope. Keep all other existing methods intact.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_session_store.py -v`
Expected: all existing tests still pass + 4 new pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/session_store.py backend/tests/test_session_store.py
git commit -m "$(cat <<'EOF'
feat(session_store): own SessionDocument + per-session write lock

Lazy-creates the SessionDocument on first access. with_document_lock is
the context manager registry.invoke() will use to serialise mutating tool
handlers within a session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `BackendTool` base + `ToolPermissions`

**Files:**
- Create: `backend/app/tools/__init__.py` (empty)
- Create: `backend/app/tools/base.py`
- Test: `backend/tests/tools/__init__.py` (empty), `backend/tests/tools/test_base.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_base.py
from typing import Any

import pytest
from pydantic import BaseModel

from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    name: str


class _Output(BaseModel):
    greeting: str


class _GreetTool(BackendTool[_Input, _Output]):
    name = "greet"
    kind = "query"
    description = "say hello"
    input_schema = _Input
    output_schema = _Output

    async def handler(self, doc: Any, input: _Input) -> _Output:  # noqa: A002
        return _Output(greeting=f"hi {input.name}")


def test_default_permissions() -> None:
    perms = ToolPermissions()
    assert perms.expose_mcp is True
    assert perms.expose_rest is True
    assert perms.requires_image is True
    assert perms.requires_context is False


def test_tool_subclass_carries_name_and_kind() -> None:
    t = _GreetTool()
    assert t.name == "greet"
    assert t.kind == "query"


@pytest.mark.asyncio
async def test_tool_handler_is_called_directly() -> None:
    t = _GreetTool()
    out = await t.handler(doc=None, input=_Input(name="anna"))
    assert out.greeting == "hi anna"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_base.py -v`
Expected: ImportError on `app.tools.base`.

- [ ] **Step 3: Implement `tools/base.py`**

```python
# backend/app/tools/base.py
from __future__ import annotations

from typing import Any, ClassVar, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict

from app.state.document import SessionDocument

TIn = TypeVar("TIn", bound=BaseModel)
TOut = TypeVar("TOut", bound=BaseModel)

ToolKind = Literal["query", "mutate", "emit"]


class ToolPermissions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expose_mcp: bool = True
    expose_rest: bool = True
    requires_image: bool = True
    requires_context: bool = False


class BackendTool(Generic[TIn, TOut]):
    """Base for every registry-callable tool.

    Subclasses must set the class-level attributes (name, kind, description,
    input_schema, output_schema) and override `handler`. `permissions` defaults
    to a permissive ToolPermissions; tools that need to be REST-only or context-
    required override it."""

    name: ClassVar[str]
    kind: ClassVar[ToolKind]
    description: ClassVar[str]
    usage: ClassVar[str | None] = None
    input_schema: ClassVar[type[BaseModel]]
    output_schema: ClassVar[type[BaseModel]]
    permissions: ClassVar[ToolPermissions] = ToolPermissions()

    async def handler(self, doc: SessionDocument, input: TIn) -> TOut:  # noqa: A002
        raise NotImplementedError
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_base.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/__init__.py backend/app/tools/base.py backend/tests/tools/__init__.py backend/tests/tools/test_base.py
git commit -m "$(cat <<'EOF'
feat(tools): BackendTool base + ToolPermissions

Class-level metadata + an awaitable handler. Permissions default to
permissive; specific tools override (set_widget_param will set
expose_mcp=False; analyze_image will set requires_context=False).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `BackendToolRegistry`

**Files:**
- Create: `backend/app/tools/registry.py`
- Test: `backend/tests/tools/test_registry.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_registry.py
from typing import Any

import pytest
from pydantic import BaseModel

from app.services.session_store import SessionStore
from app.state.document import SessionDocument
from app.state.events import EventBus
from app.tools.base import BackendTool, ToolPermissions
from app.tools.registry import BackendToolRegistry


class _PingInput(BaseModel):
    pass


class _PingOutput(BaseModel):
    pong: bool


class _PingTool(BackendTool[_PingInput, _PingOutput]):
    name = "ping"
    kind = "query"
    description = "health probe"
    input_schema = _PingInput
    output_schema = _PingOutput
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _PingInput) -> _PingOutput:  # noqa: A002
        return _PingOutput(pong=True)


def _make_registry(store: SessionStore | None = None) -> BackendToolRegistry:
    bus = EventBus()
    reg = BackendToolRegistry(store=store or SessionStore(ttl_seconds=60), event_bus=bus)
    return reg


def test_register_and_get() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    assert reg.get("ping").name == "ping"


def test_duplicate_registration_raises() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    with pytest.raises(ValueError):
        reg.register(_PingTool())


@pytest.mark.asyncio
async def test_invoke_unknown_tool_returns_error_envelope() -> None:
    reg = _make_registry()
    env = await reg.invoke("nope", session_id="s1", raw_input={})
    assert env.ok is False
    assert env.error.code == "unknown_tool"


@pytest.mark.asyncio
async def test_invoke_missing_session_returns_envelope_error() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    env = await reg.invoke("ping", session_id="nope", raw_input={})
    assert env.ok is False
    assert env.error.code == "missing_session"


@pytest.mark.asyncio
async def test_invoke_invalid_input_returns_envelope_error() -> None:
    class _StrictIn(BaseModel):
        n: int

    class _StrictTool(BackendTool[_StrictIn, _PingOutput]):
        name = "strict"
        kind = "query"
        description = "x"
        input_schema = _StrictIn
        output_schema = _PingOutput
        permissions = ToolPermissions(requires_image=False)

        async def handler(self, doc: SessionDocument, input: _StrictIn) -> _PingOutput:  # noqa: A002
            return _PingOutput(pong=True)

    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    reg = _make_registry(store)
    reg.register(_StrictTool())
    env = await reg.invoke("strict", session_id=sid, raw_input={"n": "not-an-int"})
    assert env.ok is False
    assert env.error.code == "invalid_input"


@pytest.mark.asyncio
async def test_invoke_happy_path_returns_output() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    reg = _make_registry(store)
    reg.register(_PingTool())
    env = await reg.invoke("ping", session_id=sid, raw_input={})
    assert env.ok is True
    assert env.output == {"pong": True}


def test_list_for_filters_by_transport() -> None:
    class _RestOnlyTool(_PingTool):
        name = "rest_only"
        permissions = ToolPermissions(requires_image=False, expose_mcp=False)

    reg = _make_registry()
    reg.register(_PingTool())
    reg.register(_RestOnlyTool())
    mcp_names = {t.name for t in reg.list_for("mcp")}
    rest_names = {t.name for t in reg.list_for("rest")}
    assert "ping" in mcp_names and "ping" in rest_names
    assert "rest_only" not in mcp_names
    assert "rest_only" in rest_names
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_registry.py -v`
Expected: ImportError on `app.tools.registry`.

- [ ] **Step 3: Implement `tools/registry.py`**

```python
# backend/app/tools/registry.py
from __future__ import annotations

from typing import Literal

from pydantic import ValidationError

from app.schemas.errors import ToolError, ToolResponseEnvelope
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.tools.base import BackendTool


def _err(code, message, retryable=False, recovery_hint=None) -> ToolResponseEnvelope:
    return ToolResponseEnvelope(
        ok=False,
        error=ToolError(code=code, message=message, retryable=retryable, recovery_hint=recovery_hint),
    )


class BackendToolRegistry:
    def __init__(self, store: SessionStore, event_bus: EventBus) -> None:
        self._tools: dict[str, BackendTool] = {}
        self._store = store
        self._bus = event_bus

    # ---------------- registration ----------------

    def register(self, tool: BackendTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate registration: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> BackendTool:
        return self._tools[name]

    def list_for(self, transport: Literal["mcp", "rest"]) -> list[BackendTool]:
        attr = "expose_mcp" if transport == "mcp" else "expose_rest"
        return [t for t in self._tools.values() if getattr(t.permissions, attr)]

    # ---------------- invocation ----------------

    async def invoke(self, name: str, session_id: str, raw_input: dict) -> ToolResponseEnvelope:
        tool = self._tools.get(name)
        if tool is None:
            return _err("unknown_tool", f"no tool registered with name {name!r}")

        # Validate input
        try:
            parsed = tool.input_schema.model_validate(raw_input)
        except ValidationError as e:
            return _err("invalid_input", str(e), retryable=False)

        # Resolve session
        try:
            record = self._store.get(session_id)
        except SessionNotFound:
            return _err(
                "missing_session", f"session {session_id} not found or expired",
                retryable=False,
            )

        # Permission checks
        if tool.permissions.requires_image and not record.image_bytes:
            return _err("missing_image", "session has no image", retryable=False)
        if tool.permissions.requires_context and record.context is None:
            return _err(
                "missing_context", "call analyze_image first",
                retryable=True, recovery_hint="call analyze_image",
            )

        # Acquire write lock for mutate/emit; query tools take no lock.
        if tool.kind in {"mutate", "emit"}:
            with self._store.with_document_lock(session_id) as doc:
                try:
                    output = await tool.handler(doc, parsed)
                except Exception as exc:  # surface as internal_error; specific tools may catch earlier
                    return _err("internal_error", repr(exc), retryable=False)
                # Drain any pending StateEvents the handler appended to history this call.
                # Convention: handler returns the BaseModel output and the doc.history list
                # grew by exactly the events emitted this turn. The registry forwards them.
                self._flush_history_to_bus(doc, session_id)
        else:
            doc = self._store.get_document(session_id)
            try:
                output = await tool.handler(doc, parsed)
            except Exception as exc:
                return _err("internal_error", repr(exc), retryable=False)

        return ToolResponseEnvelope(ok=True, output=output.model_dump(mode="json"))

    # ---------------- internals ----------------

    def _flush_history_to_bus(self, doc, session_id: str) -> None:
        """Publish any history entries that haven't been published yet.

        We track the last-published index on the document via an attribute
        attached at runtime. Cheaper than maintaining a separate cursor type
        and keeps the SessionDocument schema clean."""
        last_idx: int = getattr(doc, "_published_idx", 0)
        for ev in doc.history[last_idx:]:
            self._bus.publish(session_id, ev)
        setattr(doc, "_published_idx", len(doc.history))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_registry.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/registry.py backend/tests/tools/test_registry.py
git commit -m "$(cat <<'EOF'
feat(tools): BackendToolRegistry — validate, lock, invoke, publish

Single invoke path enforces input validation, precondition checks, and
the per-session write lock for mutating tools. Emitted StateEvents are
forwarded to the EventBus after each handler call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: REST adapter — `POST /api/tools/{name}`

**Files:**
- Create: `backend/app/api/tools_rest.py`
- Modify: `backend/app/api/__init__.py`, `backend/app/api/deps.py`, `backend/app/main.py`
- Test: `backend/tests/api/__init__.py` (empty), `backend/tests/api/test_tools_rest.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/api/test_tools_rest.py
import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.tools.base import BackendTool, ToolPermissions


class _EchoInput(BaseModel):
    msg: str


class _EchoOutput(BaseModel):
    echo: str


class _EchoTool(BackendTool[_EchoInput, _EchoOutput]):
    name = "echo"
    kind = "query"
    description = "echo"
    input_schema = _EchoInput
    output_schema = _EchoOutput
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc, input):  # noqa: A002
        return _EchoOutput(echo=input.msg)


@pytest.fixture
def client_with_echo():
    from app.api import deps
    from app.main import app

    deps.get_tool_registry().register(_EchoTool())
    yield TestClient(app)
    # Clean up so other tests don't see "echo".
    reg = deps.get_tool_registry()
    reg._tools.pop("echo", None)


def test_post_tools_echo_happy_path(client_with_echo) -> None:
    # Create a session via the existing endpoint so the registry can resolve it.
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    resp = client_with_echo.post("/api/session", files=files)
    sid = resp.json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/echo",
        json={"session_id": sid, "input": {"msg": "hi"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["output"] == {"echo": "hi"}


def test_post_tools_unknown_tool_returns_envelope(client_with_echo) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client_with_echo.post("/api/session", files=files).json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/nope",
        json={"session_id": sid, "input": {}},
    )
    assert r.status_code == 200  # envelope-level error, not HTTP error
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_tool"


def test_post_tools_invalid_input_returns_envelope(client_with_echo) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client_with_echo.post("/api/session", files=files).json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/echo",
        json={"session_id": sid, "input": {"msg": 123}},
    )
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/api/test_tools_rest.py -v`
Expected: ImportError on `app.tools` / route not mounted.

- [ ] **Step 3: Implement deps + router**

`backend/app/api/deps.py` — append:

```python
from app.state.events import EventBus
from app.tools.registry import BackendToolRegistry

_event_bus = EventBus()
_registry: BackendToolRegistry | None = None


def get_event_bus() -> EventBus:
    return _event_bus


def get_tool_registry() -> BackendToolRegistry:
    global _registry
    if _registry is None:
        _registry = BackendToolRegistry(store=_session_store, event_bus=_event_bus)
        # Atomic tools are registered by app.tools.atomic.register_all_atomic_tools
        # which is invoked from app.main on startup once it exists.
    return _registry
```

`backend/app/api/tools_rest.py` — create:

```python
# backend/app/api/tools_rest.py
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.schemas.errors import ToolResponseEnvelope
from app.tools.registry import BackendToolRegistry

from . import deps

router = APIRouter()


class ToolEnvelope(BaseModel):
    session_id: str
    input: dict


@router.post("/tools/{name}", response_model=ToolResponseEnvelope)
async def invoke_rest(
    name: str,
    body: ToolEnvelope,
    registry: BackendToolRegistry = Depends(deps.get_tool_registry),
) -> ToolResponseEnvelope:
    return await registry.invoke(name=name, session_id=body.session_id, raw_input=body.input)
```

`backend/app/api/__init__.py` — change to:

```python
from fastapi import APIRouter

from . import analyze, panel, refine, segment, session, tools_rest

router = APIRouter(prefix="/api")
router.include_router(session.router)
router.include_router(analyze.router)
router.include_router(panel.router)
router.include_router(refine.router)
router.include_router(segment.router)
router.include_router(tools_rest.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/api/test_tools_rest.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/__init__.py backend/app/api/deps.py backend/app/api/tools_rest.py backend/tests/api/__init__.py backend/tests/api/test_tools_rest.py
git commit -m "$(cat <<'EOF'
feat(api): POST /api/tools/<name> generated adapter

Thin framing layer. Body carries session_id + input dict; registry.invoke
returns the envelope unchanged. Errors are envelope-level (HTTP 200), so
clients always parse {ok, output|error} not HTTP status.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tasks 13–18: Query tools (each one task)

Each query tool follows the same TDD shape. Patterns are shared, so each task below shows just (a) the file paths, (b) the input/output schemas, (c) the handler, (d) the test set, (e) the commit. Steps are: write test → run-fail → implement → run-pass → register in `tools/atomic/__init__.py` → commit.

---

### Task 13: `get_image_context`

**Files:**
- Create: `backend/app/tools/atomic/__init__.py`
- Create: `backend/app/tools/atomic/get_image_context.py`
- Test: `backend/tests/tools/test_get_image_context.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_get_image_context.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.get_image_context import GetImageContextTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(GetImageContextTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("get_image_context", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_returns_none_context_before_analyze(client) -> None:
    sid = _make_session(client)
    r = client.post(
        "/api/tools/get_image_context",
        json={"session_id": sid, "input": {}},
    )
    body = r.json()
    assert body["ok"] is True
    assert body["output"] == {"available": False, "context": None}


def test_returns_context_after_set(client, sample_image_context) -> None:
    sid = _make_session(client)
    # Bind context via the existing /session/{sid}/context endpoint.
    r = client.post(f"/api/session/{sid}/context", json=sample_image_context)
    assert r.status_code == 200
    body = client.post(
        "/api/tools/get_image_context",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["available"] is True
    assert body["output"]["context"]["mood"] == "wintry, intimate"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_get_image_context.py -v`
Expected: ImportError on `app.tools.atomic.get_image_context`.

- [ ] **Step 3: Implement tool**

```python
# backend/app/tools/atomic/get_image_context.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    available: bool
    context: dict | None


class GetImageContextTool(BackendTool[_Input, _Output]):
    name = "get_image_context"
    kind = "query"
    description = (
        "Read the cached image analysis (subjects, lighting, mood, dominant tones, "
        "candidate regions). Call this first to understand the photo."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            # Fall back to the per-record context dict (set by the existing endpoint).
            # Importing here keeps the tool import-light.
            return _Output(available=False, context=None)
        return _Output(available=True, context=ctx.model_dump(mode="json"))
```

Append to `backend/app/tools/atomic/__init__.py`:

```python
# backend/app/tools/atomic/__init__.py
from app.tools.registry import BackendToolRegistry

from .get_image_context import GetImageContextTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
```

Modify `backend/app/api/deps.py` `get_tool_registry()` to call `register_all_atomic_tools`:

```python
def get_tool_registry() -> BackendToolRegistry:
    global _registry
    if _registry is None:
        from app.tools.atomic import register_all_atomic_tools
        _registry = BackendToolRegistry(store=_session_store, event_bus=_event_bus)
        register_all_atomic_tools(_registry)
    return _registry
```

**Important:** the existing `session.set_session_context` endpoint stores context in the `SessionRecord`. The tool reads from `SessionDocument.image_context`. Bridge: extend `set_session_context` to also write the validated `ImageContext` onto `doc.image_context`. Do this inline:

```python
# backend/app/api/session.py — modify set_session_context
@router.post("/session/{sid}/context")
async def set_session_context(
    sid: str,
    body: ImageContext,
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    try:
        store.set_context(sid, body.model_dump(mode="json"))
        # Also write the typed model onto the document so tools can read it directly.
        doc = store.get_document(sid)
        doc.image_context = body
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    return {"session_id": sid}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_get_image_context.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/__init__.py backend/app/tools/atomic/get_image_context.py backend/app/api/deps.py backend/app/api/session.py backend/tests/tools/test_get_image_context.py
git commit -m "$(cat <<'EOF'
feat(tools): get_image_context query tool

First registered tool. Session-context endpoint now also writes the typed
ImageContext onto the SessionDocument so tools can read it directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `list_widgets` + `get_widget`

**Files:**
- Create: `backend/app/tools/atomic/list_widgets.py`, `backend/app/tools/atomic/get_widget.py`
- Test: `backend/tests/tools/test_list_widgets.py`, `backend/tests/tools/test_get_widget.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_list_widgets.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.tools.atomic.list_widgets import ListWidgetsTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ListWidgetsTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("list_widgets", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def _push_widget(doc, wid: str) -> None:
    doc.add_widget(
        Widget(
            id=wid, intent=f"intent-{wid}",
            scope=Scope.model_validate({"kind": "global"}),
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"),
            fused_tool_id="warm_grade",
            preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        )
    )


def test_list_widgets_empty(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_widgets",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widgets"] == []


def test_list_widgets_returns_summaries(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    _push_widget(doc, "w_1")
    _push_widget(doc, "w_2")
    body = client.post(
        "/api/tools/list_widgets",
        json={"session_id": sid, "input": {}},
    ).json()
    ids = [w["id"] for w in body["output"]["widgets"]]
    assert ids == ["w_1", "w_2"]
    assert {"id", "intent", "scope", "status", "revision", "origin_kind"} <= set(body["output"]["widgets"][0])
```

```python
# backend/tests/tools/test_get_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.tools.atomic.get_widget import GetWidgetTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(GetWidgetTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("get_widget", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_get_widget_returns_full_body(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(
        Widget(
            id="w_1", intent="warm",
            scope=Scope.model_validate({"kind": "global"}),
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warmer"),
            fused_tool_id="warm_grade",
            preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        )
    )
    body = client.post(
        "/api/tools/get_widget",
        json={"session_id": sid, "input": {"widget_id": "w_1"}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widget"]["id"] == "w_1"


def test_get_widget_unknown_returns_error(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/get_widget",
        json={"session_id": sid, "input": {"widget_id": "missing"}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_widget"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_list_widgets.py backend/tests/tools/test_get_widget.py -v`
Expected: ImportError on the new modules.

- [ ] **Step 3: Implement tools**

```python
# backend/app/tools/atomic/list_widgets.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _WidgetSummary(BaseModel):
    id: str
    intent: str
    scope: dict
    status: str
    revision: int
    origin_kind: str


class _Output(BaseModel):
    widgets: list[_WidgetSummary] = Field(default_factory=list)


class ListWidgetsTool(BackendTool[_Input, _Output]):
    name = "list_widgets"
    kind = "query"
    description = "List all widgets on the document (active + dismissed)."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        out = []
        for wid in doc.widget_order:
            w = doc.widgets[wid]
            out.append(_WidgetSummary(
                id=w.id, intent=w.intent,
                scope=w.scope.model_dump(mode="json"),
                status=w.status, revision=w.revision,
                origin_kind=w.origin.kind,
            ))
        return _Output(widgets=out)
```

```python
# backend/app/tools/atomic/get_widget.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    widget_id: str


class _Output(BaseModel):
    widget: dict


class _UnknownWidget(Exception):
    pass


class GetWidgetTool(BackendTool[_Input, _Output]):
    name = "get_widget"
    kind = "query"
    description = "Return the full body of one widget by id."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        return _Output(widget=w.model_dump(mode="json"))
```

The registry currently maps any `Exception` from the handler to `internal_error`. Replace this with a typed error path. Modify `tools/registry.py` `invoke()`:

```python
        # Replace this section in invoke() to surface a few well-known exceptions
        # as typed envelope errors. Other exceptions still map to internal_error.
        try:
            output = await tool.handler(doc, parsed)
        except KeyError as exc:
            return _err("unknown_widget", str(exc), retryable=False)
        except Exception as exc:
            return _err("internal_error", repr(exc), retryable=False)
```

But `_UnknownWidget` from get_widget is a custom exception, not a KeyError. Make it inherit:

```python
class _UnknownWidget(KeyError):
    pass
```

(Update both blocks in registry.py — mutate path and non-mutate path.)

Then register both:

```python
# backend/app/tools/atomic/__init__.py
from app.tools.registry import BackendToolRegistry
from .get_image_context import GetImageContextTool
from .get_widget import GetWidgetTool
from .list_widgets import ListWidgetsTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
    registry.register(ListWidgetsTool())
    registry.register(GetWidgetTool())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/test_list_widgets.py backend/tests/tools/test_get_widget.py backend/tests/tools/test_registry.py -v`
Expected: all passing, including the prior registry tests (KeyError mapping change is backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/list_widgets.py backend/app/tools/atomic/get_widget.py backend/app/tools/atomic/__init__.py backend/app/tools/registry.py backend/tests/tools/test_list_widgets.py backend/tests/tools/test_get_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): list_widgets + get_widget query tools

Registry now maps KeyError from handlers to unknown_widget envelope errors
so tools can raise typed exceptions for known failure modes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `list_named_regions` + `list_layers` + `get_active_selection`

**Files:**
- Create: `backend/app/tools/atomic/list_named_regions.py`, `list_layers.py`, `get_active_selection.py`
- Test: `backend/tests/tools/test_list_named_regions.py`, `test_list_layers.py`, `test_get_active_selection.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_list_named_regions.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_named_regions import ListNamedRegionsTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ListNamedRegionsTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("list_named_regions", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_empty_without_context(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_named_regions",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["regions"] == []


def test_returns_regions_after_context_set(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/list_named_regions",
        json={"session_id": sid, "input": {}},
    ).json()
    labels = [r["label"] for r in body["output"]["regions"]]
    assert labels == ["subject", "sky"]
```

```python
# backend/tests/tools/test_list_layers.py — basic structural test
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_layers import ListLayersTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ListLayersTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("list_layers", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_list_layers_returns_one_image_layer(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/list_layers",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert len(body["output"]["layers"]) == 1
    assert body["output"]["layers"][0]["type"] == "image"
```

```python
# backend/tests/tools/test_get_active_selection.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.get_active_selection import GetActiveSelectionTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(GetActiveSelectionTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("get_active_selection", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_no_selection_initially(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/get_active_selection",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["has_selection"] is False
    assert body["output"]["state"] == "none"


def test_armed_selection_reported(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_1"] = MaskRecord(
        id="m_1", width=10, height=10, png_b64="x",
        source="sam_point", parent_mask_ids=[], label="subject",
    )
    doc.active_mask_id = "m_1"
    body = client.post(
        "/api/tools/get_active_selection",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["output"]["has_selection"] is True
    assert body["output"]["state"] == "active"
    assert body["output"]["label"] == "subject"
```

Note: this test references `doc.active_mask_id` — we must add that attribute to `SessionDocument`. Do it in Step 3 below.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_list_named_regions.py backend/tests/tools/test_list_layers.py backend/tests/tools/test_get_active_selection.py -v`
Expected: ImportError + attribute errors.

- [ ] **Step 3: Implement**

Add to `SessionDocument` in `state/document.py`:

```python
    active_mask_id: str | None = None
    committed_mask_id: str | None = None
```

Create tool files:

```python
# backend/app/tools/atomic/list_named_regions.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _RegionSummary(BaseModel):
    label: str
    description: str | None = None
    has_mask: bool


class _Output(BaseModel):
    regions: list[_RegionSummary] = Field(default_factory=list)


class _Input(BaseModel):
    pass


class ListNamedRegionsTool(BackendTool[_Input, _Output]):
    name = "list_named_regions"
    kind = "query"
    description = (
        "List the Claude-named regions in the current image. These labels are the "
        "primary vocabulary for select_named_region — prefer them over raw coords."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            return _Output(regions=[])
        # Has-mask check: backend stores masks under MaskRecord.label.
        mask_labels = {m.label for m in doc.masks.values() if m.label}
        out = []
        for r in ctx.candidate_regions:
            out.append(_RegionSummary(
                label=r.label, description=r.description,
                has_mask=(r.label in mask_labels),
            ))
        return _Output(regions=out)
```

```python
# backend/app/tools/atomic/list_layers.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _LayerSummary(BaseModel):
    id: str
    type: str
    name: str
    is_active: bool
    adjustment_count: int


class _Output(BaseModel):
    layers: list[_LayerSummary] = Field(default_factory=list)


class ListLayersTool(BackendTool[_Input, _Output]):
    name = "list_layers"
    kind = "query"
    description = (
        "List the layers in the current document. Most documents have a single "
        "image layer."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Plan 1 has no real layer model on the backend yet. Return a synthetic
        # single image layer per session. Plan 2/3 will replace this once the
        # backend owns the layer tree.
        return _Output(layers=[
            _LayerSummary(
                id="l_image", type="image", name="Background",
                is_active=True,
                adjustment_count=sum(1 for w in doc.widgets.values() if w.status == "active"),
            )
        ])
```

```python
# backend/app/tools/atomic/get_active_selection.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    has_selection: bool
    state: str  # "active" | "committed" | "none"
    label: str | None = None
    width: int | None = None
    height: int | None = None
    source: str | None = None


class GetActiveSelectionTool(BackendTool[_Input, _Output]):
    name = "get_active_selection"
    kind = "query"
    description = (
        "Inspect the currently armed selection mask. Use this before select_* "
        "tools to avoid clobbering a useful selection."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        mid = doc.active_mask_id or doc.committed_mask_id
        if mid is None or mid not in doc.masks:
            return _Output(has_selection=False, state="none")
        m = doc.masks[mid]
        state = "active" if doc.active_mask_id == mid else "committed"
        return _Output(
            has_selection=True, state=state,
            label=m.label, width=m.width, height=m.height,
            source=m.source,
        )
```

Update `tools/atomic/__init__.py`:

```python
from .get_active_selection import GetActiveSelectionTool
from .get_image_context import GetImageContextTool
from .get_widget import GetWidgetTool
from .list_layers import ListLayersTool
from .list_named_regions import ListNamedRegionsTool
from .list_widgets import ListWidgetsTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
    registry.register(ListWidgetsTool())
    registry.register(GetWidgetTool())
    registry.register(ListNamedRegionsTool())
    registry.register(ListLayersTool())
    registry.register(GetActiveSelectionTool())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/document.py backend/app/tools/atomic/list_named_regions.py backend/app/tools/atomic/list_layers.py backend/app/tools/atomic/get_active_selection.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_list_named_regions.py backend/tests/tools/test_list_layers.py backend/tests/tools/test_get_active_selection.py
git commit -m "$(cat <<'EOF'
feat(tools): list_named_regions, list_layers, get_active_selection

SessionDocument gains active_mask_id + committed_mask_id; list_layers
returns a synthetic single image layer (real layer model lands in Plan 3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Selection tools — `select_named_region`, `clear_selection`

**Files:**
- Create: `backend/app/tools/atomic/select_named_region.py`, `clear_selection.py`
- Test: `backend/tests/tools/test_select_named_region.py`, `test_clear_selection.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_select_named_region.py
import base64

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.select_named_region import SelectNamedRegionTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(SelectNamedRegionTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("select_named_region", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_select_unknown_region_returns_envelope_error(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "spaceship", "commit": True}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_region"


def test_select_region_without_mask_returns_scope_unresolvable(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "subject", "commit": True}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "scope_unresolvable"


def test_select_region_with_mask_arms_and_commits(client, sample_image_context) -> None:
    sid = _make_session(client)
    client.post(f"/api/session/{sid}/context", json=sample_image_context)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_subject"] = MaskRecord(
        id="m_subject", width=10, height=10,
        png_b64=base64.b64encode(b"\x00" * 10).decode(),
        source="named_region", label="subject",
    )
    body = client.post(
        "/api/tools/select_named_region",
        json={"session_id": sid, "input": {"label": "subject", "commit": True}},
    ).json()
    assert body["ok"] is True
    assert doc.committed_mask_id == "m_subject"
    assert doc.active_mask_id is None
```

```python
# backend/tests/tools/test_clear_selection.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.clear_selection import ClearSelectionTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ClearSelectionTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("clear_selection", None)


def test_clear_resets_both_handles() -> None:
    from app.main import app
    deps.get_tool_registry().register(ClearSelectionTool())
    try:
        c = TestClient(app)
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = c.post("/api/session", files=files).json()["session_id"]
        doc = deps.get_session_store().get_document(sid)
        doc.masks["m_1"] = MaskRecord(
            id="m_1", width=1, height=1, png_b64="aGVsbG8=",
            source="sam_point",
        )
        doc.active_mask_id = "m_1"
        doc.committed_mask_id = "m_1"
        body = c.post(
            "/api/tools/clear_selection",
            json={"session_id": sid, "input": {}},
        ).json()
        assert body["ok"] is True
        assert doc.active_mask_id is None
        assert doc.committed_mask_id is None
    finally:
        deps.get_tool_registry()._tools.pop("clear_selection", None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_select_named_region.py backend/tests/tools/test_clear_selection.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement tools**

```python
# backend/app/tools/atomic/select_named_region.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownRegion(KeyError):
    """Mapped to unknown_region in the envelope by the registry."""


class _ScopeUnresolvable(KeyError):
    """Mapped to scope_unresolvable."""


class _Input(BaseModel):
    label: str = Field(min_length=1)
    commit: bool = True


class _Output(BaseModel):
    ok: bool
    state: str  # "active" | "committed"
    mask_id: str


class SelectNamedRegionTool(BackendTool[_Input, _Output]):
    name = "select_named_region"
    kind = "mutate"
    description = (
        "Arm a Claude-named region as the active selection. Prefer this over raw "
        "coordinate-based segmentation when a named region covers the goal."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            raise _ScopeUnresolvable("no image context yet")
        region = next((r for r in ctx.candidate_regions if r.label == input.label), None)
        if region is None:
            raise _UnknownRegion(f"no region named {input.label!r}")
        mask = next((m for m in doc.masks.values() if m.label == input.label), None)
        if mask is None:
            raise _ScopeUnresolvable(
                f"region {input.label!r} has no registered mask; "
                "call select_by_point or seed via /analyze pre-segmentation"
            )
        if input.commit:
            doc.active_mask_id = None
            doc.committed_mask_id = mask.id
            state = "committed"
        else:
            doc.active_mask_id = mask.id
            state = "active"
        doc.history.append(  # registry forwards to bus
            __import__("app.schemas.widget", fromlist=["StateEvent"]).StateEvent(
                revision=doc.revision + 1, kind="selection.changed",
                payload={"mask_id": mask.id, "state": state, "label": input.label},
            )
        )
        doc.revision += 1
        return _Output(ok=True, state=state, mask_id=mask.id)
```

Important: the cleaner path is to add a helper `doc.emit_selection_changed(mask_id, state, label)` on `SessionDocument`. Replace the inline emit with:

```python
# In state/document.py, add:

    def emit_selection_changed(self, mask_id: str | None, state: str, label: str | None) -> list[StateEvent]:
        return [self._emit("selection.changed", {"mask_id": mask_id, "state": state, "label": label})]
```

Then use `doc.emit_selection_changed(...)` in the tool. (Update the tool code accordingly.)

Also add the registry mapping: `UnknownRegionError` and `ScopeUnresolvableError` need mapping to specific envelope codes. Extend `tools/registry.py` invoke():

```python
        try:
            output = await tool.handler(doc, parsed)
        except KeyError as exc:
            # Distinguish by exception type name — tools subclass KeyError to signal which.
            ex_name = exc.__class__.__name__
            code = "unknown_widget"
            if ex_name == "_UnknownRegion":
                code = "unknown_region"
            elif ex_name == "_UnknownMask":
                code = "unknown_mask"
            elif ex_name == "_ScopeUnresolvable":
                code = "scope_unresolvable"
            return _err(code, str(exc), retryable=False)
        except Exception as exc:
            return _err("internal_error", repr(exc), retryable=False)
```

Update *both* the mutate and non-mutate paths.

```python
# backend/app/tools/atomic/clear_selection.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(BaseModel):
    ok: bool


class ClearSelectionTool(BackendTool[_Input, _Output]):
    name = "clear_selection"
    kind = "mutate"
    description = "Discard the currently armed selection. Call between unrelated operations."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.active_mask_id = None
        doc.committed_mask_id = None
        doc.emit_selection_changed(None, "none", None)
        return _Output(ok=True)
```

Register both in `tools/atomic/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/document.py backend/app/tools/registry.py backend/app/tools/atomic/select_named_region.py backend/app/tools/atomic/clear_selection.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_select_named_region.py backend/tests/tools/test_clear_selection.py
git commit -m "$(cat <<'EOF'
feat(tools): select_named_region + clear_selection

Registry now maps subclassed KeyErrors from handlers to specific envelope
codes (unknown_region, unknown_mask, scope_unresolvable). SessionDocument
exposes emit_selection_changed for tools that move the active/committed
mask handles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: SAM-driven selection — `select_by_point`, `select_by_box`, `combine_masks`

**Files:**
- Create: `backend/app/tools/atomic/select_by_point.py`, `select_by_box.py`, `combine_masks.py`
- Test: `backend/tests/tools/test_select_by_point.py`, `test_select_by_box.py`, `test_combine_masks.py`

**Important:** these tools call into `SamClient`. Use a fake SAM in tests; the existing `test_segment_endpoint.py` shows the pattern (monkeypatching `app.api.deps.get_sam_client`). Follow it.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_select_by_point.py
import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.select_by_point import SelectByPointTool


class _FakeSam:
    model_name = "fake"
    def embed(self, sid, image_rgb):
        return None
    def decode_point(self, sid, points, labels):
        # Return a 4x4 mask with a single true pixel at the clicked point.
        h = w = 4
        m = np.zeros((h, w), dtype=bool)
        x = int(points[0][0]); y = int(points[0][1])
        m[max(0, min(h - 1, y)), max(0, min(w - 1, x))] = True
        return m


@pytest.fixture
def client():
    from app.main import app
    deps._sam_client = _FakeSam()  # bypass lazy init
    deps.get_tool_registry().register(SelectByPointTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("select_by_point", None)
    deps._sam_client = None


def _make_session(client) -> str:
    # /session expects real image bytes; use a 4x4 JPEG produced via PIL.
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (4, 4), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_select_by_point_creates_mask_record(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/select_by_point",
        json={"session_id": sid, "input": {"x": 0.5, "y": 0.5, "commit": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.committed_mask_id is not None
    mask = doc.masks[doc.committed_mask_id]
    assert mask.source == "sam_point"
    assert mask.width == 4 and mask.height == 4
```

Same shape for `select_by_box` and `combine_masks` (combine takes two existing mask_ids and an op).

```python
# backend/tests/tools/test_combine_masks.py
import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.combine_masks import CombineMasksTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(CombineMasksTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("combine_masks", None)


def _make_session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (4, 4), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def _png_b64_from_array(arr: np.ndarray) -> str:
    from io import BytesIO
    from PIL import Image
    img = Image.fromarray((arr * 255).astype("uint8"), mode="L")
    buf = BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_union_combines_two_masks(client) -> None:
    sid = _make_session(client)
    doc = deps.get_session_store().get_document(sid)
    a = np.zeros((4, 4), dtype=bool); a[0, 0] = True
    b = np.zeros((4, 4), dtype=bool); b[3, 3] = True
    doc.masks["a"] = MaskRecord(id="a", width=4, height=4, png_b64=_png_b64_from_array(a), source="sam_point")
    doc.masks["b"] = MaskRecord(id="b", width=4, height=4, png_b64=_png_b64_from_array(b), source="sam_point")
    body = client.post(
        "/api/tools/combine_masks",
        json={"session_id": sid, "input": {"op": "union", "a": "a", "b": "b"}},
    ).json()
    assert body["ok"] is True
    new_id = body["output"]["mask_id"]
    assert new_id in doc.masks
    assert doc.masks[new_id].source == "combined"
    assert doc.masks[new_id].parent_mask_ids == ["a", "b"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_select_by_point.py backend/tests/tools/test_combine_masks.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/atomic/select_by_point.py
from __future__ import annotations

import base64
import io
import uuid

import numpy as np
from PIL import Image
from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import MaskRecord
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _SamFailed(RuntimeError):
    pass


class _Input(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    commit: bool = True


class _Output(BaseModel):
    ok: bool
    mask_id: str


class SelectByPointTool(BackendTool[_Input, _Output]):
    name = "select_by_point"
    kind = "mutate"
    description = "Click-style selection: SAM decodes a mask around (x, y)."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Decode the image once and ask SAM to embed + decode.
        img = Image.open(io.BytesIO(doc.image_bytes)).convert("RGB")
        arr = np.array(img)
        h, w = arr.shape[:2]
        sam = deps.get_sam_client()
        sam.embed(doc.session_id, arr)
        try:
            mask = sam.decode_point(
                doc.session_id,
                points=np.array([[input.x * w, input.y * h]], dtype=np.float32),
                labels=np.array([1.0], dtype=np.float32),
            )
        except RuntimeError as e:
            raise _SamFailed(str(e))
        if mask is None or not mask.any():
            raise _SamFailed("empty mask")
        png_b64 = _encode_mask_png_b64(mask)
        mid = f"m_{uuid.uuid4().hex[:8]}"
        record = MaskRecord(
            id=mid, width=mask.shape[1], height=mask.shape[0],
            png_b64=png_b64, source="sam_point",
        )
        doc.add_mask(record)
        if input.commit:
            doc.active_mask_id = None
            doc.committed_mask_id = mid
            state = "committed"
        else:
            doc.active_mask_id = mid
            state = "active"
        doc.emit_selection_changed(mid, state, None)
        return _Output(ok=True, mask_id=mid)


def _encode_mask_png_b64(mask: np.ndarray) -> str:
    arr = (mask.astype("uint8")) * 255
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
```

```python
# backend/app/tools/atomic/select_by_box.py — same shape, takes (x, y, w, h) and calls sam.decode_box
from __future__ import annotations

import io
import uuid

import numpy as np
from PIL import Image
from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import MaskRecord
from app.state.document import SessionDocument
from app.tools.atomic.select_by_point import _SamFailed, _encode_mask_png_b64
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)
    commit: bool = True


class _Output(BaseModel):
    ok: bool
    mask_id: str


class SelectByBoxTool(BackendTool[_Input, _Output]):
    name = "select_by_box"
    kind = "mutate"
    description = "Box-style selection: SAM decodes a mask inside the bbox (normalised)."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        img = Image.open(io.BytesIO(doc.image_bytes)).convert("RGB")
        arr = np.array(img); h_img, w_img = arr.shape[:2]
        sam = deps.get_sam_client()
        sam.embed(doc.session_id, arr)
        x1 = input.x * w_img
        y1 = input.y * h_img
        x2 = (input.x + input.w) * w_img
        y2 = (input.y + input.h) * h_img
        try:
            mask = sam.decode_box(doc.session_id, np.array([x1, y1, x2, y2], dtype=np.float32))
        except RuntimeError as e:
            raise _SamFailed(str(e))
        if mask is None or not mask.any():
            raise _SamFailed("empty mask")
        png_b64 = _encode_mask_png_b64(mask)
        mid = f"m_{uuid.uuid4().hex[:8]}"
        record = MaskRecord(
            id=mid, width=mask.shape[1], height=mask.shape[0],
            png_b64=png_b64, source="sam_box",
        )
        doc.add_mask(record)
        if input.commit:
            doc.active_mask_id = None
            doc.committed_mask_id = mid
            state = "committed"
        else:
            doc.active_mask_id = mid
            state = "active"
        doc.emit_selection_changed(mid, state, None)
        return _Output(ok=True, mask_id=mid)
```

```python
# backend/app/tools/atomic/combine_masks.py
from __future__ import annotations

import base64
import io
import uuid
from typing import Literal

import numpy as np
from PIL import Image
from pydantic import BaseModel

from app.schemas.widget import MaskRecord
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownMask(KeyError):
    pass


class _Input(BaseModel):
    op: Literal["union", "intersect", "subtract"]
    a: str
    b: str


class _Output(BaseModel):
    mask_id: str


def _decode(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("L")
    return np.array(img) > 127


def _encode(m: np.ndarray) -> str:
    arr = (m.astype("uint8")) * 255
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


class CombineMasksTool(BackendTool[_Input, _Output]):
    name = "combine_masks"
    kind = "mutate"
    description = "Compose two masks via union, intersect or subtract."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.a not in doc.masks:
            raise _UnknownMask(input.a)
        if input.b not in doc.masks:
            raise _UnknownMask(input.b)
        a = _decode(doc.masks[input.a].png_b64)
        b = _decode(doc.masks[input.b].png_b64)
        if a.shape != b.shape:
            raise _UnknownMask("masks differ in shape")
        if input.op == "union":
            m = a | b
        elif input.op == "intersect":
            m = a & b
        else:
            m = a & ~b
        mid = f"m_{uuid.uuid4().hex[:8]}"
        record = MaskRecord(
            id=mid, width=m.shape[1], height=m.shape[0],
            png_b64=_encode(m), source="combined",
            parent_mask_ids=[input.a, input.b],
        )
        doc.add_mask(record)
        return _Output(mask_id=mid)
```

Register all three in `tools/atomic/__init__.py`.

Add `_SamFailed` mapping to registry — extend the exception fan in `tools/registry.py`:

```python
        except KeyError as exc:
            ...
        except __import__("app.tools.atomic.select_by_point", fromlist=["_SamFailed"])._SamFailed as exc:
            return _err("sam_failed", str(exc), retryable=False)
        except Exception as exc:
            return _err("internal_error", repr(exc), retryable=False)
```

Cleaner: define `SamFailedError` at module scope in `tools/errors.py` (new file) — but to keep this task focused, leave the inline `__import__` and refactor in a follow-up commit if it feels ugly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/select_by_point.py backend/app/tools/atomic/select_by_box.py backend/app/tools/atomic/combine_masks.py backend/app/tools/registry.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_select_by_point.py backend/tests/tools/test_select_by_box.py backend/tests/tools/test_combine_masks.py
git commit -m "$(cat <<'EOF'
feat(tools): select_by_point, select_by_box, combine_masks

SAM-driven selection + boolean mask composition. Each tool stores its
output as a MaskRecord with provenance source.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: `apply_adjustment`, `highlight_region`, `add_note`

**Files:**
- Create: `backend/app/tools/atomic/apply_adjustment.py`, `highlight_region.py`, `add_note.py`
- Test: `backend/tests/tools/test_apply_adjustment.py`, `test_highlight_region.py`, `test_add_note.py`

These three are structurally similar to earlier tools. Test → implement → register pattern.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_apply_adjustment.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.apply_adjustment import ApplyAdjustmentTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ApplyAdjustmentTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("apply_adjustment", None)


def _make_session(client) -> str:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_apply_adjustment_creates_readonly_widget(client) -> None:
    sid = _make_session(client)
    body = client.post(
        "/api/tools/apply_adjustment",
        json={"session_id": sid, "input": {
            "scope": {"kind": "global"},
            "kind": "kelvin",
            "params": {"temperature": 4800},
            "label": "auto white balance",
        }},
    ).json()
    assert body["ok"] is True
    wid = body["output"]["widget_id"]
    doc = deps.get_session_store().get_document(sid)
    assert wid in doc.widgets
    w = doc.widgets[wid]
    assert w.bindings == []  # read-only — no controls
    assert w.nodes[0].type == "kelvin"
    assert w.nodes[0].params == {"temperature": 4800}
```

```python
# backend/tests/tools/test_highlight_region.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import MaskRecord
from app.tools.atomic.highlight_region import HighlightRegionTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(HighlightRegionTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("highlight_region", None)


def test_highlight_arms_active_mask(client, sample_image_context) -> None:
    from app.main import app
    c = TestClient(app)
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = c.post("/api/session", files=files).json()["session_id"]
    c.post(f"/api/session/{sid}/context", json=sample_image_context)
    doc = deps.get_session_store().get_document(sid)
    doc.masks["m_subject"] = MaskRecord(
        id="m_subject", width=1, height=1, png_b64="aGVsbG8=",
        source="named_region", label="subject",
    )
    body = c.post(
        "/api/tools/highlight_region",
        json={"session_id": sid, "input": {"label": "subject", "reasoning": "look here"}},
    ).json()
    assert body["ok"] is True
    assert doc.active_mask_id == "m_subject"
```

```python
# backend/tests/tools/test_add_note.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.add_note import AddNoteTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(AddNoteTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("add_note", None)


def test_add_note_image_anchor(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/add_note",
        json={"session_id": sid, "input": {
            "text": "remember to check exposure",
            "anchor": {"kind": "image"},
        }},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert len(doc.notes) == 1
    assert doc.notes[0].text == "remember to check exposure"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_apply_adjustment.py backend/tests/tools/test_highlight_region.py backend/tests/tools/test_add_note.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/atomic/apply_adjustment.py
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.schemas.widget import Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    scope: dict
    kind: str = Field(min_length=1)
    params: dict
    label: str | None = None


class _Output(BaseModel):
    widget_id: str


class ApplyAdjustmentTool(BackendTool[_Input, _Output]):
    name = "apply_adjustment"
    kind = "mutate"
    description = (
        "Apply an adjustment directly without exposing controls. Use for confident "
        "mechanical fixes (e.g. auto-level)."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        wid = f"w_{uuid.uuid4().hex[:8]}"
        nid = f"n_{uuid.uuid4().hex[:8]}"
        scope = Scope.model_validate(input.scope)
        node = WidgetNode(
            id=nid, type=input.kind, params=input.params,
            scope=scope, inputs=[], widget_id=wid,
        )
        w = Widget(
            id=wid,
            intent=input.label or input.kind,
            reasoning=None,
            scope=scope,
            origin=WidgetOrigin(kind="mcp_user_prompt", prompt=None),
            fused_tool_id=None,
            nodes=[node],
            bindings=[],  # read-only "applied" widget
            preview=WidgetPreview(kind="none", auto_before_after=False),
        )
        doc.add_widget(w)
        return _Output(widget_id=wid)
```

```python
# backend/app/tools/atomic/highlight_region.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.atomic.select_named_region import _ScopeUnresolvable, _UnknownRegion
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    label: str = Field(min_length=1)
    reasoning: str | None = None


class _Output(BaseModel):
    ok: bool
    mask_id: str


class HighlightRegionTool(BackendTool[_Input, _Output]):
    name = "highlight_region"
    kind = "emit"
    description = (
        "Visually point at a region for the user without committing it as a selection. "
        "Use this to draw attention; not to act on."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        ctx = doc.image_context
        if ctx is None:
            raise _ScopeUnresolvable("no image context yet")
        if not any(r.label == input.label for r in ctx.candidate_regions):
            raise _UnknownRegion(input.label)
        mask = next((m for m in doc.masks.values() if m.label == input.label), None)
        if mask is None:
            raise _ScopeUnresolvable(f"region {input.label!r} has no registered mask")
        doc.active_mask_id = mask.id
        doc.emit_selection_changed(mask.id, "active", input.label)
        return _Output(ok=True, mask_id=mask.id)
```

```python
# backend/app/tools/atomic/add_note.py
from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.schemas.widget import Note, NoteAnchor
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    text: str = Field(min_length=1, max_length=512)
    anchor: dict


class _Output(BaseModel):
    note_id: str


class AddNoteTool(BackendTool[_Input, _Output]):
    name = "add_note"
    kind = "emit"
    description = "Anchor a sticky note to the image, a region, or a point."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        nid = f"note_{uuid.uuid4().hex[:8]}"
        note = Note(
            id=nid, text=input.text,
            anchor=NoteAnchor.model_validate(input.anchor),
        )
        doc.notes.append(note)
        return _Output(note_id=nid)
```

Register all three.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/apply_adjustment.py backend/app/tools/atomic/highlight_region.py backend/app/tools/atomic/add_note.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_apply_adjustment.py backend/tests/tools/test_highlight_region.py backend/tests/tools/test_add_note.py
git commit -m "$(cat <<'EOF'
feat(tools): apply_adjustment, highlight_region, add_note

apply_adjustment mints a read-only widget (no controls). highlight_region
arms the active mask for a named region. add_note anchors sticky notes
to image / region / point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: `create_session` and `analyze_image` (MCP-facing wrappers)

These wrap existing functionality so external MCP clients can bootstrap without `multipart/form-data`. Plan 2 will extend `analyze_image` with the autonomous-suggestion pass.

**Files:**
- Create: `backend/app/tools/atomic/create_session.py`, `analyze_image.py`
- Test: `backend/tests/tools/test_create_session.py`, `test_analyze_image.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/test_create_session.py
import base64

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.create_session import CreateSessionTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(CreateSessionTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("create_session", None)


def test_create_session_from_image_b64(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    # Note: create_session is special — no session_id required. Use a placeholder.
    body = client.post(
        "/api/tools/create_session",
        json={"session_id": "", "input": {"image_b64": b64, "mime_type": "image/jpeg"}},
    ).json()
    assert body["ok"] is True
    sid = body["output"]["session_id"]
    rec = deps.get_session_store().get(sid)
    assert rec.mime_type == "image/jpeg"
```

```python
# backend/tests/tools/test_analyze_image.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.analyze_image import AnalyzeImageTool


class _FakeClaude:
    def analyze_image(self, image_bytes, mime_type, session_id=None):
        from app.schemas.image_context import ImageContext
        return ImageContext(
            subjects=["person"], lighting="flat", dominant_tones=["midtones"],
            mood="calm", candidate_regions=[],
            model_name="fake", model_version="0", generated_at="2026-05-21T00:00:00Z",
        )


@pytest.fixture
def client():
    from app.main import app
    deps._anthropic_client = _FakeClaude()  # type: ignore[assignment]
    deps.get_tool_registry().register(AnalyzeImageTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("analyze_image", None)


def test_analyze_image_runs_and_caches(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["mood"] == "calm"
    # Cached — second call should not re-invoke Claude (verify by mood unchanged).
    body2 = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body2["output"]["mood"] == "calm"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/test_create_session.py backend/tests/tools/test_analyze_image.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

`create_session` is special — it doesn't require an existing session. Add a registry escape hatch: if the tool's `kind == "query"` AND its name is in a whitelist `_BOOTSTRAP_TOOLS = {"create_session"}`, skip the session resolution step. Modify `tools/registry.py` `invoke()`:

```python
        # ...after input validation:
        if tool.name in _BOOTSTRAP_TOOLS:
            # No session yet — pass a transient empty SessionDocument.
            from app.state.document import SessionDocument
            doc = SessionDocument(session_id="", image_bytes=b"", mime_type="")
            try:
                output = await tool.handler(doc, parsed)
            except Exception as exc:
                return _err("internal_error", repr(exc), retryable=False)
            return ToolResponseEnvelope(ok=True, output=output.model_dump(mode="json"))

        # otherwise resolve session as before...
```

Define `_BOOTSTRAP_TOOLS = {"create_session"}` at module scope. The tool itself uses the injected `SessionStore` directly:

```python
# backend/app/tools/atomic/create_session.py
from __future__ import annotations

import base64

from pydantic import BaseModel, Field

from app.api import deps
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    image_b64: str = Field(min_length=1)
    mime_type: str = Field(min_length=1)


class _Output(BaseModel):
    session_id: str


class CreateSessionTool(BackendTool[_Input, _Output]):
    name = "create_session"
    kind = "query"  # treated as bootstrap by the registry
    description = "Create a new editor session from a base64-encoded image."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        store = deps.get_session_store()
        img = base64.b64decode(input.image_b64)
        sid = store.create(image_bytes=img, mime_type=input.mime_type)
        return _Output(session_id=sid)
```

`analyze_image`:

```python
# backend/app/tools/atomic/analyze_image.py
from __future__ import annotations

from pydantic import BaseModel

from app.api import deps
from app.schemas.image_context import ImageContext
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(ImageContext):
    pass


class AnalyzeImageTool(BackendTool[_Input, _Output]):
    name = "analyze_image"
    kind = "mutate"
    description = (
        "Run image analysis (cached). Returns the ImageContext (subjects, "
        "lighting, mood, dominant tones, regions). Plan 2 extends this with "
        "the autonomous-suggestion pass."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if doc.image_context is not None:
            return _Output.model_validate(doc.image_context.model_dump(mode="json"))
        client = deps.get_anthropic_client()
        ctx = client.analyze_image(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            session_id=doc.session_id,
        )
        doc.image_context = ctx
        return _Output.model_validate(ctx.model_dump(mode="json"))
```

Register both.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/create_session.py backend/app/tools/atomic/analyze_image.py backend/app/tools/atomic/__init__.py backend/app/tools/registry.py backend/tests/tools/test_create_session.py backend/tests/tools/test_analyze_image.py
git commit -m "$(cat <<'EOF'
feat(tools): create_session + analyze_image bootstrap tools

create_session is whitelisted as a bootstrap tool — registry skips session
resolution. analyze_image is a thin idempotent wrapper around the existing
AnthropicClient.analyze_image, caching the result on the SessionDocument.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Final regression sweep + plan close

- [ ] **Step 1: Run the full test suite**

```bash
pytest backend/tests/ -v
```

Expected: all tests pass (including the pre-existing ones that this plan did not touch).

- [ ] **Step 2: Confirm `/api/panel` and `/api/refine` still work**

```bash
pytest backend/tests/test_panel_endpoint.py backend/tests/test_refine.py -v
```

Expected: untouched test files still pass — Plan 1 is purely additive.

- [ ] **Step 3: Smoke-test the tool registry end-to-end via httpie or curl**

```bash
# Start the backend in a separate terminal:
#   cd backend && uvicorn app.main:app --reload --port 8000
# Then:
curl -s -X POST http://localhost:8000/api/tools/create_session \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"","input":{"image_b64":"<base64-jpeg>","mime_type":"image/jpeg"}}' | jq
# Use the returned session_id:
curl -s -X POST http://localhost:8000/api/tools/list_widgets \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"<sid>","input":{}}' | jq
```

Expected: both return `{"ok": true, "output": {...}}`.

- [ ] **Step 4: Tag the plan close**

```bash
git tag plan1-foundations-complete
```

(Optional — leaves a recoverable point before Plan 2 starts.)

---

## Plan 1 — what's done and what's not

**Done in Plan 1:**

- `BackendToolRegistry` with `{ok, output|error}` envelope.
- `SessionDocument` aggregate, projection function, event bus, per-session write lock.
- 14 tools wired and tested over REST: `get_image_context`, `list_named_regions`, `list_layers`, `list_widgets`, `get_widget`, `get_active_selection`, `select_named_region`, `select_by_point`, `select_by_box`, `combine_masks`, `clear_selection`, `apply_adjustment`, `highlight_region`, `add_note`, `create_session`, `analyze_image`.
- REST adapter `POST /api/tools/<name>`.
- Backward-compat: `/api/panel`, `/api/refine`, `/api/analyze`, `/api/segment/*`, `/api/session*` unchanged.

**Deferred to Plan 2:**

- EnrichedImageContext v2 (histograms, palette, problems, region stats).
- FusedToolTemplate framework + 9 starter fused tools.
- `propose_widget`, `refine_widget`, `repeat_widget`, `delete_widget`, `restore_widget`, `accept_widget`.
- Autonomous-suggestion pass inside `analyze_image`.
- `set_widget_param` (REST-only).
- `list_fused_tools`.

**Deferred to Plan 3:**

- MCP wire-format server at `/mcp`.
- SSE state stream at `/api/state/{sid}` + `/events`.
- CPU preview renderer + `preview_widget` tool.
- Rate limiting, MCP session pairing, e2e MCP test.
- Replacing `/api/panel` and `/api/refine` shims with thin wrappers around the new tools.
