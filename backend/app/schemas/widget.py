from __future__ import annotations

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


# Subsequent tasks extend this module with ControlBinding, Widget, etc.
