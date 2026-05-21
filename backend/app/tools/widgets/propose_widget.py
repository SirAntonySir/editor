from __future__ import annotations

from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import Scope, WidgetOrigin
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool


class _FusedToolNotFound(KeyError):
    """Mapped to fused_tool_not_found in the envelope by the registry."""
    pass


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    fused_tool_id: str | None = None
    prompt: str | None = None


class _Output(BaseModel):
    widget: dict


class ProposeWidgetTool(BackendTool[_Input, _Output]):
    name = "propose_widget"
    kind = "mutate"
    description = (
        "Mint a widget. If fused_tool_id is given, that template is used. Otherwise "
        "Claude picks one for the intent; if none fits, an ad-hoc widget is built."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        scope = Scope.model_validate(input.scope)
        templates = {t.id: t for t in all_fused_templates()}

        fused_id = input.fused_tool_id
        if fused_id is not None and fused_id not in templates:
            raise _FusedToolNotFound(fused_id)

        anthropic = deps.get_anthropic_client()
        if fused_id is None:
            candidates = [
                {"id": t.id, "description": t.description, "typical_use": t.typical_use}
                for t in templates.values()
            ]
            fused_id = anthropic.name_pick_fused_tool(
                intent=input.intent, candidates=candidates, session_id=doc.session_id,
            )
            if fused_id is None or fused_id not in templates:
                fused_id = "warm_grade"

        template = templates[fused_id]
        origin = WidgetOrigin(
            kind="mcp_user_prompt", prompt=input.prompt or input.intent, parent_widget_id=None,
        )
        widget = await run_fused_tool(
            template,
            intent=input.intent, scope=scope, ctx=doc.image_context,
            prior=None, instruction=None, anthropic=anthropic,
            origin=origin,
        )
        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json"))
