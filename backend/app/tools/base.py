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
