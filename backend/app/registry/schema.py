from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


PRESET_SOURCE = Literal["builtin", "user", "project"]
PARAM_TYPE = Literal["scalar", "curve_points", "color_hsv", "enum", "bool"]
CONTROL_TYPE = Literal[
    "slider", "swatch", "hue_wheel", "curve_editor", "point_list",
    "enum_select", "bool_toggle", "kelvin_strip",
]


class OpParamSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: PARAM_TYPE
    default: Any
    range: tuple[float, float] | None = None
    unit: str | None = None
    step: float | None = None               # slider step; defaults to 1 when absent
    values: list[str] | None = None         # enum
    min_points: int | None = None           # curve_points
    max_points: int | None = None           # curve_points

    @model_validator(mode="after")
    def _shape_checks(self) -> OpParamSchema:
        if self.type == "scalar" and self.range is None:
            raise ValueError("scalar params require `range`")
        if self.type == "enum" and not self.values:
            raise ValueError("enum params require `values`")
        if self.type == "curve_points":
            pts = self.default
            if not isinstance(pts, list) or len(pts) < 2 or any(not (isinstance(p, list) and len(p) == 2) for p in pts):
                raise ValueError("curve_points default must be a list of at least 2 [x, y] pairs")
        return self


class OpBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    param_key: str
    control_type: CONTROL_TYPE
    label: str
    group: str | None = None


class OpLlmMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: str
    typical_use: str
    semantic_tags: list[str] = Field(default_factory=list)


class OpEngineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shader: str
    render_order: int
    node_type: str


class CompoundAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    position: float = Field(ge=0.0, le=1.0)
    name: str
    values: dict[str, float]
    color: str | None = None    # CSS color string for wheel wedge


class OpCompoundConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    driver: str
    interpolation: Literal["catmull_rom_1d"] = "catmull_rom_1d"
    anchors: list[CompoundAnchor] = Field(min_length=2)
    topology: Literal["linear", "wheel"] = "linear"

    @model_validator(mode="after")
    def _checks(self) -> OpCompoundConfig:
        positions = [a.position for a in self.anchors]
        if positions != sorted(positions) or len(set(positions)) != len(positions):
            raise ValueError("anchors must have strictly increasing positions")
        all_keys = {k for a in self.anchors for k in a.values.keys()}
        for a in self.anchors:
            missing = all_keys - set(a.values.keys())
            if missing:
                raise ValueError(f"anchor {a.name!r} missing keys {missing}")
        return self


class RegistryOp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    display_name: str
    category: str | None = None    # planner grouping hint + Cmd+K section header
    icon: str | None = None        # Material icon name (frontend-only, opaque here)
    llm: OpLlmMetadata
    params: dict[str, OpParamSchema]
    bindings: list[OpBinding]
    engine: OpEngineConfig
    tool_defaults: list[str] | None = None  # curated subset of param keys for toolrail widget
    compound: OpCompoundConfig | None = None

    @model_validator(mode="after")
    def _bindings_reference_params(self) -> RegistryOp:
        for b in self.bindings:
            if b.param_key not in self.params:
                raise ValueError(f"binding param_key {b.param_key!r} not in params")
        # compound validation
        if self.compound:
            if self.compound.driver not in self.params:
                raise ValueError(
                    f"compound driver {self.compound.driver!r} not in params"
                )
            for a in self.compound.anchors:
                for k in a.values:
                    if k not in self.params:
                        raise ValueError(
                            f"anchor value key {k!r} not in op.params"
                        )
        return self


class PresetOp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op_id: str
    params: dict[str, Any]


class RegistryPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    display_name: str
    source: PRESET_SOURCE = "builtin"
    category: str | None = None    # Cmd+K grouping
    icon: str | None = None        # Material icon name (frontend-only, opaque here)
    description: str
    typical_use: str
    semantic_tags: list[str] = Field(default_factory=list)
    ops: list[PresetOp]
