from __future__ import annotations

import uuid

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.schemas.widget import Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
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
            op_id=None,
            nodes=[node],
            bindings=[],
            preview=WidgetPreview(kind="none", auto_before_after=False),
        )
        doc.add_widget(w)
        return _Output(widget_id=wid)
