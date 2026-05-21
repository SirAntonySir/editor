from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates


class _Input(BaseModel):
    pass


class _ToolEntry(BaseModel):
    id: str
    description: str
    typical_use: str
    param_envelope: dict
    requires_scope: str


class _Output(BaseModel):
    tools: list[_ToolEntry] = Field(default_factory=list)


class ListFusedToolsTool(BackendTool[_Input, _Output]):
    name = "list_fused_tools"
    kind = "query"
    description = "List the available fused tools and their parameter envelopes."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        out = []
        for t in all_fused_templates():
            out.append(_ToolEntry(
                id=t.id,
                description=t.description,
                typical_use=t.typical_use,
                param_envelope={
                    k: v.model_dump() for k, v in t.param_envelope.items()
                },
                requires_scope=t.requires_scope,
            ))
        return _Output(tools=out)
