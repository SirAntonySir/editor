from __future__ import annotations

import uuid

from pydantic import AliasChoices, BaseModel, Field

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
from app.tools.tool_defaults import TOOL_DEFAULTS


class _InvalidInput(Exception):
    """Mapped to invalid_input in the envelope by the registry."""
    pass


class _MissingContext(Exception):
    """Mapped to missing_context in the envelope by the registry.
    Also re-raised by propose_stack for the LLM path guard."""
    pass


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    op_id: str | None = Field(default=None, validation_alias=AliasChoices("op_id", "fused_tool_id"))
    prompt: str | None = None
    layer_id: str = "legacy"
    origin: WidgetOriginKind = "mcp_user_prompt"


class _Output(BaseModel):
    widget: dict


class ProposeWidgetTool(BackendTool[_Input, _Output]):
    name = "propose_widget"
    kind = "mutate"
    description = (
        "Mint a LUT/filter widget via the tool_invoked fast path. "
        "Only the 'filter' op_id is supported; all other adjustments "
        "should use propose_stack instead."
    )
    input_schema = _Input
    output_schema = _Output
    # requires_context is False so the tool_invoked fast path (ships TOOL_DEFAULTS,
    # no LLM, no image_context use) isn't blocked before analyze_image runs.
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        scope = Scope.model_validate(input.scope)

        # Only the tool_invoked fast path is supported (LUT/filter only).
        # All other adjustments and LLM-driven spawns now go through propose_stack.
        if input.origin != "tool_invoked":
            raise _InvalidInput(
                "propose_widget only supports origin='tool_invoked' for LUT/filter. "
                "Use propose_stack for all other origins."
            )
        return self._handle_tool_invoked(doc, input, scope)

    def _handle_tool_invoked(
        self,
        doc: SessionDocument,
        input: _Input,  # noqa: A002
        scope: Scope,
    ) -> _Output:
        """Build a widget from TOOL_DEFAULTS without any LLM call.

        Only the 'filter' op_id is expected here; filters/LUT are not yet
        modeled in the SSoT registry so they stay on this path.
        """
        tool_id = input.op_id
        if tool_id is None or tool_id not in TOOL_DEFAULTS:
            raise _InvalidInput(
                f"Unknown op_id for tool_invoked origin: {tool_id!r}. "
                f"Valid ids: {sorted(TOOL_DEFAULTS)}"
            )

        defaults = TOOL_DEFAULTS[tool_id]
        widget_id = f"w_{uuid.uuid4().hex[:8]}"

        # For image_node scope, propagate the scope's layer_ids to every node
        # and prefer the first layer as the legacy single-layer attribution.
        image_node_layer_ids: list[str] | None = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)
            layer_id_for_nodes = (
                image_node_layer_ids[0] if image_node_layer_ids else input.layer_id
            )
        else:
            layer_id_for_nodes = input.layer_id

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
                layer_id=layer_id_for_nodes,
                layer_ids=image_node_layer_ids,
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
            op_id=tool_id,
            composed=False,
            nodes=nodes,
            bindings=bindings,
            preview=WidgetPreview(kind="none", auto_before_after=False),
            rejected_attempts=[],
            # Spawn as an editable shell on the canvas. The toolbar click
            # creates the widget "active"; the user tunes it and commits via
            # Apply (accept_widget), which flips status → "accepted".
            status="active",
            revision=1,
        )
        # Canonical seeding now happens centrally in doc.add_widget (covers
        # tool_invoked + fused + autonomous paths).
        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json"))
