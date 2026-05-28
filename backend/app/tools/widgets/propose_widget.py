from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetOriginKind,
    WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool
from app.tools.tool_defaults import TOOL_DEFAULTS


class _FusedToolNotFound(KeyError):
    """Mapped to fused_tool_not_found in the envelope by the registry."""
    pass


class _InvalidInput(Exception):
    """Mapped to invalid_input in the envelope by the registry."""
    pass


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    fused_tool_id: str | None = None
    prompt: str | None = None
    layer_id: str = "legacy"
    origin: WidgetOriginKind = "mcp_user_prompt"


class _Output(BaseModel):
    widget: dict


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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

        # ----------------------------------------------------------------
        # Fast path: tool_invoked bypasses LLM entirely.
        # ----------------------------------------------------------------
        if input.origin == "tool_invoked":
            return self._handle_tool_invoked(doc, input, scope)

        # ----------------------------------------------------------------
        # Normal path: LLM picks / resolves a fused tool.
        # ----------------------------------------------------------------
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
            kind=input.origin, prompt=input.prompt or input.intent, parent_widget_id=None,
        )
        widget = await run_fused_tool(
            template,
            intent=input.intent, scope=scope, ctx=doc.image_context,
            prior=None, instruction=None, anthropic=anthropic,
            origin=origin,
        )
        # Stamp layer_id on every node.
        for node in widget.nodes:
            node.layer_id = input.layer_id

        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json"))

    def _handle_tool_invoked(
        self,
        doc: SessionDocument,
        input: _Input,  # noqa: A002
        scope: Scope,
    ) -> _Output:
        """Build a widget from TOOL_DEFAULTS without any LLM call."""
        tool_id = input.fused_tool_id
        if tool_id is None or tool_id not in TOOL_DEFAULTS:
            raise _InvalidInput(
                f"Unknown fused_tool_id for tool_invoked origin: {tool_id!r}. "
                f"Valid ids: {sorted(TOOL_DEFAULTS)}"
            )

        defaults = TOOL_DEFAULTS[tool_id]
        widget_id = f"w_{uuid.uuid4().hex[:8]}"

        nodes: list[WidgetNode] = []
        for nd in defaults["nodes"]:
            nid = f"n_{uuid.uuid4().hex[:6]}"
            nodes.append(WidgetNode(
                id=nid,
                type=nd["type"],
                params=nd["params"],
                scope=scope,
                inputs=[],
                widget_id=widget_id,
                layer_id=input.layer_id,
            ))

        bindings: list[ControlBinding] = []
        # All bindings target the first (and usually only) node.
        target_node_id = nodes[0].id if nodes else widget_id
        for bd in defaults["bindings"]:
            bindings.append(ControlBinding(
                param_key=bd["param_key"],
                label=bd["label"],
                control_type=bd["control_type"],
                control_schema=ControlSchema.model_validate(bd["control_schema"]),
                value=bd["value"],
                default=bd["default"],
                target=NodeParamTarget(node_id=target_node_id, param_key=bd["param_key"]),
            ))

        widget = Widget(
            id=widget_id,
            intent=input.intent,
            scope=scope,
            origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
            fused_tool_id=tool_id,
            composed=False,
            nodes=nodes,
            bindings=bindings,
            preview=WidgetPreview(kind="none", auto_before_after=False),
            rejected_attempts=[],
            status="accepted",
            revision=1,
        )
        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json"))
