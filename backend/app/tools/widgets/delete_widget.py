from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.widget import DismissalRule, Scope
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    suppress_similar: bool = True


class _Output(BaseModel):
    ok: bool


def _normalise_intent(s: str) -> str:
    return " ".join(s.lower().split())


def _scope_signature(scope: Scope) -> str:
    r = scope.root
    if r.kind == "global":
        return "global"
    if r.kind == "named_region":
        return f"named_region:{r.label}"
    return f"mask:{r.mask_id}"


class DeleteWidgetTool(BackendTool[_Input, _Output]):
    name = "delete_widget"
    kind = "mutate"
    description = "Dismiss a widget. Optionally suppress similar autonomous suggestions."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        rule = None
        if input.suppress_similar:
            rule = DismissalRule(
                id=f"d_{uuid.uuid4().hex[:8]}",
                source_widget_id=w.id,
                intent_norm=_normalise_intent(w.intent),
                scope_signature=_scope_signature(w.scope),
                fused_tool_id=w.fused_tool_id,
            )
        doc.dismiss_widget(input.widget_id, rule=rule)
        return _Output(ok=True)
