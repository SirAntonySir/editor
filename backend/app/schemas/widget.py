from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, RootModel

from app.schemas._camel import camel_config


# ------------------------------------------------------------------
# Scope — what a tool / widget targets.
# ------------------------------------------------------------------


class GlobalScope(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["global"]


class NamedRegionScope(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["named_region"]
    label: str = Field(min_length=1)


class MaskScope(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["mask"]
    mask_id: str = Field(min_length=1)


class ImageNodeScope(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["image_node"]
    image_node_id: str = Field(min_length=1)
    layer_ids: list[str] = Field(default_factory=list)


_ScopeAny = Annotated[
    Union[GlobalScope, NamedRegionScope, MaskScope, ImageNodeScope],
    Field(discriminator="kind"),
]


class Scope(RootModel[_ScopeAny]):
    """Discriminated union over the scope kinds."""


# ------------------------------------------------------------------
# Node + binding target
# ------------------------------------------------------------------


class NodeParamTarget(BaseModel):
    model_config = camel_config(extra="forbid")
    node_id: str = Field(min_length=1)
    param_key: str = Field(min_length=1)


# Subsequent tasks extend this module with Widget, etc.


# ------------------------------------------------------------------
# Control catalog — one schema class per control_type.
# ------------------------------------------------------------------


ControlType = Literal[
    # Legacy widget-schema values (kept for backwards compatibility with
    # serialised state that pre-dates the SSoT registry alignment).
    "slider", "numeric_pair", "toggle", "choice", "color", "curve",
    "curve_point", "mask_thumbnail", "region_picker",
    "before_after_toggle", "histogram_marker", "text",
    # Registry-vocab additions (aligned with CONTROL_TYPE in registry/schema.py).
    "swatch", "hue_wheel", "curve_editor", "point_list",
    "enum_select", "bool_toggle", "kelvin_strip",
]


class SliderSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["slider"]
    min: float
    max: float
    step: float
    unit: str = ""


class NumericPairSchema(BaseModel):
    model_config = camel_config(extra="forbid")
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
    model_config = camel_config(extra="forbid")
    control_type: Literal["toggle"]
    on_label: str = "On"
    off_label: str = "Off"


class ChoiceOption(BaseModel):
    model_config = camel_config(extra="forbid")
    value: str
    label: str
    swatch: list[int] | None = None  # optional RGB swatch shown beside option


class ChoiceSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["choice"]
    options: list[ChoiceOption] = Field(min_length=1)
    allow_custom: bool = False


class ColorSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["color"]
    space: Literal["rgb", "lab", "hsl"] = "rgb"
    show_alpha: bool = False
    presets: list[list[int]] = Field(default_factory=list)


class CurveSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["curve"]
    # None means "all channels" (multi-channel curves control).
    channel: Literal["luma", "r", "g", "b"] | None = None
    min_points: int = 2
    max_points: int = 16


class CurvePointSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["curve_point"]
    channel: Literal["luma", "r", "g", "b"]
    x_min: float = 0.0
    x_max: float = 1.0
    y_min: float = 0.0
    y_max: float = 1.0


class MaskThumbnailSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["mask_thumbnail"]
    allow_replace: bool = True
    allow_combine: list[Literal["union", "intersect", "subtract"]] = Field(default_factory=list)


class RegionPickerSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["region_picker"]
    candidate_labels: list[str] = Field(default_factory=list)
    allow_active_selection: bool = True
    allow_global: bool = True


class BeforeAfterToggleSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["before_after_toggle"]
    split_orientation: Literal["horizontal", "vertical", "swap"] = "swap"


class HistogramMarkerSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["histogram_marker"]
    channel: Literal["luma", "r", "g", "b"]
    marker_kind: Literal["black_point", "white_point", "gamma"]


class TextSchema(BaseModel):
    model_config = camel_config(extra="forbid")
    control_type: Literal["text"]
    max_len: int = 256
    placeholder: str = ""


# ------------------------------------------------------------------
# Registry-vocab control schemas (aligned with SSoT registry/schema.py)
# ------------------------------------------------------------------


class SwatchSchema(BaseModel):
    """Colour swatch picker — mirrors ColorSchema but uses registry vocab."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["swatch"]
    space: Literal["rgb", "lab", "hsl"] = "rgb"
    show_alpha: bool = False
    presets: list[list[int]] = Field(default_factory=list)


class HueWheelSchema(BaseModel):
    """Hue wheel — degree range [min, max]."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["hue_wheel"]
    min: float = 0.0
    max: float = 360.0


class CurveEditorSchema(BaseModel):
    """Full curve editor — mirrors CurveSchema but uses registry vocab."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["curve_editor"]
    channel: Literal["luma", "r", "g", "b"] | None = None
    min_points: int = 2
    max_points: int = 16


class PointListSchema(BaseModel):
    """Editable list of curve/spline points (debug / advanced editor)."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["point_list"]
    min_points: int = 2
    max_points: int = 16


class EnumSelectSchema(BaseModel):
    """Drop-down / segmented enum selector — mirrors ChoiceSchema."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["enum_select"]
    options: list[ChoiceOption] = Field(min_length=1)
    allow_custom: bool = False


class BoolToggleSchema(BaseModel):
    """Boolean toggle — mirrors ToggleSchema."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["bool_toggle"]
    on_label: str = "On"
    off_label: str = "Off"


class KelvinStripSchema(BaseModel):
    """Kelvin temperature strip — same fields as SliderSchema."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["kelvin_strip"]
    min: float
    max: float
    step: float
    unit: str = "K"


class TintStripSchema(BaseModel):
    """Green↔magenta tint strip — same fields as SliderSchema, painted with a
    teal-to-magenta gradient track on the frontend. Paired with kelvin_strip
    on white-balance ops."""
    model_config = camel_config(extra="forbid")
    control_type: Literal["tint_strip"]
    min: float
    max: float
    step: float
    unit: str | None = None


_ControlSchemaAny = Annotated[
    Union[
        SliderSchema, NumericPairSchema, ToggleSchema, ChoiceSchema, ColorSchema,
        CurveSchema, CurvePointSchema, MaskThumbnailSchema, RegionPickerSchema,
        BeforeAfterToggleSchema, HistogramMarkerSchema, TextSchema,
        # Registry-vocab additions:
        SwatchSchema, HueWheelSchema, CurveEditorSchema, PointListSchema,
        EnumSelectSchema, BoolToggleSchema, KelvinStripSchema, TintStripSchema,
    ],
    Field(discriminator="control_type"),
]


class ControlSchema(RootModel[_ControlSchemaAny]):
    """Discriminated union over all control_type schemas."""
    pass


ControlValue = Union[float, int, str, bool, list, dict]


class ControlBinding(BaseModel):
    model_config = camel_config(extra="forbid")
    param_key: str = Field(min_length=1)
    label: str
    control_type: ControlType
    target: NodeParamTarget
    control_schema: ControlSchema
    value: ControlValue
    default: ControlValue
    reasoning: str | None = None


# ------------------------------------------------------------------
# Node fragment + origin + preview
# ------------------------------------------------------------------


ParamValue = Union[float, int, str, bool, list, dict]


class WidgetNode(BaseModel):
    model_config = camel_config(extra="forbid")
    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    op_id: str | None = None    # NEW — source registry op id for frontend identification
    params: dict[str, ParamValue] = Field(default_factory=dict)
    scope: Scope
    inputs: list[str] = Field(default_factory=list)
    widget_id: str = Field(min_length=1)
    layer_id: str = "legacy"
    layer_ids: list[str] | None = None  # populated for image_node-scope widgets


WidgetOriginKind = Literal[
    "mcp_user_prompt", "mcp_autonomous", "user_palette", "fused_expansion",
    "refine", "repeat", "tool_invoked",
]


class WidgetOrigin(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: WidgetOriginKind
    prompt: str | None = None
    parent_widget_id: str | None = None
    anchor: str | None = None


class WidgetPreview(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["thumbnail", "histogram_delta", "color_swatches", "none"]
    auto_before_after: bool = False


class ResolvedNumbers(BaseModel):
    """One attempt's tunable values + optional reasoning. Used both by the
    fused-tool framework (Plan 2) and by Widget.rejected_attempts for the
    repeat-widget anchor log."""
    model_config = camel_config(extra="forbid")
    values: dict[str, ParamValue]
    reasoning: str | None = None


class Widget(BaseModel):
    model_config = camel_config(extra="forbid")
    id: str = Field(min_length=1)
    intent: str = Field(min_length=1)
    reasoning: str | None = None
    scope: Scope
    origin: WidgetOrigin
    op_id: str | None = Field(default=None, validation_alias=AliasChoices("op_id", "fused_tool_id"))
    composed: bool = False
    nodes: list[WidgetNode] = Field(default_factory=list)
    bindings: list[ControlBinding] = Field(default_factory=list)
    preview: WidgetPreview = Field(
        default_factory=lambda: WidgetPreview(kind="thumbnail", auto_before_after=True)
    )
    rejected_attempts: list[ResolvedNumbers] = Field(default_factory=list)
    status: Literal["active", "dismissed", "accepted"] = "active"
    revision: int = 1
    # Per-binding user locks. When a user manually edits a binding's value
    # (typically via set_widget_param), its `param_key` is appended here so
    # later compound/bundle recomputation skips it. Cleared via
    # `unlock_widget_param`. Empty by default for backwards-compatible
    # spawning.
    locked_params: list[str] = Field(default_factory=list)
    display_name: str | None = None    # NEW — per-widget label (smart composition)
    category: str | None = None         # NEW — for grouping (smart composition)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Revision at which this widget was dismissed. None for active/accepted
    # widgets. Set by dismiss_widget so gc_dismissed_widgets can hard-delete
    # entries whose dismissal aged past the bounded history window. Cleared
    # in restore_widget.
    dismissed_at_revision: int | None = None


# ------------------------------------------------------------------
# Mask, note, dismissal, event
# ------------------------------------------------------------------


class MaskRecord(BaseModel):
    model_config = camel_config(extra="forbid")
    id: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    png_b64: str = Field(min_length=1)
    source: Literal["sam_point", "sam_box", "named_region", "painted", "combined"]
    parent_mask_ids: list[str] = Field(default_factory=list)
    label: str | None = None
    # Multi-image-canvas: identifies the ImageNode this mask targets.
    # Optional for backwards-compat; None is treated as a "global"
    # mask by frontend consumers so legacy fixtures keep rendering.
    image_node_id: str | None = None


class NoteAnchorRegion(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["region"]
    label: str = Field(min_length=1)


class NoteAnchorPoint(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["point"]
    x: float
    y: float


class NoteAnchorImage(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["image"]


_NoteAnchorAny = Annotated[
    Union[NoteAnchorRegion, NoteAnchorPoint, NoteAnchorImage],
    Field(discriminator="kind"),
]


class NoteAnchor(RootModel[_NoteAnchorAny]):
    """Discriminated union over note anchor kinds."""
    pass


class Note(BaseModel):
    model_config = camel_config(extra="forbid")
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    anchor: NoteAnchor
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DismissalRule(BaseModel):
    model_config = camel_config(extra="forbid")
    id: str = Field(min_length=1)
    source_widget_id: str = Field(min_length=1)
    intent_norm: str
    scope_signature: str
    fused_tool_id: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


StateEventKind = Literal[
    "widget.created", "widget.updated", "widget.deleted",
    "widget.accepted", "widget.restored",
    "mask.created", "mask.deleted", "mask.renamed",
    "selection.changed",
    "context.updated", "dismissal.added",
    "note.created",
    "phase.started", "phase.progress", "phase.completed", "phase.cancelled",
    "canonical.updated",
    "image_node_transform.updated",
    "mcp.usage",
    # P3 — emitted by SessionDocument.apply_snapshot for undo/redo/revert.
    # Carries the full restored snapshot summary (op_graph + widget list +
    # masks index) so the frontend can swap state in one shot.
    "history.applied",
    # P2 SSE gap signal — backend can't replay missed events because the
    # log was pruned past the client's Last-Event-ID. Frontend refetches
    # the full snapshot.
    "state.gap",
    # Study-design AI_access flip from the admin cockpit. Payload
    # {"ai_access": bool}; lets the running app toggle AI surfaces live
    # without a reload.
    "session.ai_access",
]


class StateEvent(BaseModel):
    model_config = camel_config(extra="forbid")
    revision: int = Field(ge=0)
    kind: StateEventKind
    payload: dict
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
