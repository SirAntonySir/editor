from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.api import deps
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import ResolvedNumbers, run_fused_tool


class _UnknownWidget(KeyError):
    pass


class _InvalidInput(Exception):
    """Mapped to invalid_input in the envelope by the registry."""
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    feedback: str | None = None


class _Output(BaseModel):
    widget: dict


class RepeatWidgetTool(BackendTool[_Input, _Output]):
    name = "repeat_widget"
    kind = "mutate"
    description = (
        "Re-roll a widget: ask Claude for a meaningfully different result for the "
        "same intent + scope. Only valid on un-composed fused-tool widgets."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        if w.op_id is None or w.composed:
            raise _InvalidInput("repeat is only valid on un-composed fused-tool widgets")

        templates = {t.id: t for t in all_fused_templates()}
        template = templates[w.op_id]
        current = ResolvedNumbers(values={b.param_key: b.value for b in w.bindings})
        w.rejected_attempts.append(current)

        instruction = input.feedback or "The user rejected the previous attempt. Produce a meaningfully different result for the same intent."
        anthropic = deps.get_anthropic_client()
        new_widget = await run_fused_tool(
            template, intent=w.intent, scope=w.scope, ctx=doc.image_context,
            prior=w, instruction=instruction, anthropic=anthropic, origin=w.origin,
        )
        new_widget.id = w.id
        new_widget.revision = w.revision + 1
        new_widget.rejected_attempts = w.rejected_attempts
        doc.update_widget(new_widget)
        return _Output(widget=new_widget.model_dump(mode="json", by_alias=True))
