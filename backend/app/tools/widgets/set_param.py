from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = Field(min_length=1)
    op: str = Field(min_length=1)
    param: str = Field(min_length=1)
    value: float | int | str | bool | list | dict


class _Output(BaseModel):
    ok: bool


class SetParamTool(BackendTool[_Input, _Output]):
    name = "set_param"
    kind = "mutate"
    description = (
        "Write a single canonical (layer, op, param) value directly — no widget "
        "required. The Adjustments accordion edits canonical state through this. "
        "REST-only — accordion/slider editing is a human pointing-device action, "
        "not an agent action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.set_param(input.layer_id, input.op, input.param, input.value)
        return _Output(ok=True)
