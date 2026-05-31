from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ScopeKind = Literal["global", "mask:click", "mask:proposed"]


class Scope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ScopeKind
    # For mask:proposed — model-supplied label + representative point.
    label: str | None = None
    point: tuple[float, float] | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: str  # Resolved against ProcessingRegistry at runtime.
    scope: Scope = Field(default_factory=lambda: Scope(kind="global"))
    params: dict[str, float | int | str | bool | list | dict] = Field(default_factory=dict)
    inputs: list[str] = Field(default_factory=list)  # node IDs
    layer_id: str  # which frontend layer this node renders into
    layer_ids: list[str] | None = None  # populated for image_node-scope nodes
    widget_id: str | None = None  # originating Widget id (for delete_widget cleanup); None for canonical nodes


class PanelBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_id: str
    param_key: str
    label: str
    control: Literal["slider", "toggle", "picker"] = "slider"
    min: int | float | None = None
    max: int | float | None = None
    default: int | float | str | bool | None = None
    step: int | float | None = None
    reasoning: str | None = None


class OperationGraph(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    user_goal: str
    reasoning: str | None = None
    nodes: list[Node]
    panel_bindings: list[PanelBinding]
    metadata: dict[str, str] = Field(default_factory=dict)
