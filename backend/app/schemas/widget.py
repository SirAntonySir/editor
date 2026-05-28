from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Union

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


# ------------------------------------------------------------------
# Node + binding target
# ------------------------------------------------------------------


class NodeParamTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str = Field(min_length=1)
    param_key: str = Field(min_length=1)


# Subsequent tasks extend this module with Widget, etc.


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
    """Discriminated union over all control_type schemas."""
    pass


ControlValue = Union[float, int, str, bool, list, dict]


class ControlBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
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
    """Discriminated union over note anchor kinds."""
    pass


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
    "note.created",
    "phase.started", "phase.progress", "phase.completed",
]


class StateEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    kind: StateEventKind
    payload: dict
    emitted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
