from __future__ import annotations

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.api import deps
from app.schemas.widget import ResolvedNumbers
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions


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
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return "Re-rolled widget"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        if w.op_id is None or w.composed:
            raise _InvalidInput("repeat is only valid on un-composed fused-tool widgets")

        # Resolve the registry op via w.op_id first; fall back to nodes[0].op_id
        # for persisted template widgets (op_id is a template name like "golden_hour")
        # and for multi-op widgets whose widget-level op_id predates the registry-op
        # convention.
        from app.registry.loader import get_registry
        reg = get_registry()
        op = reg.ops.get(w.op_id) or (
            reg.ops.get(w.nodes[0].op_id)
            if w.nodes and w.nodes[0].op_id
            else None
        )
        node = w.nodes[0] if w.nodes else None
        if op is None or node is None:
            raise _InvalidInput(
                f"repeat requires a registry op; op_id={w.op_id!r} is not registered"
            )

        # Snapshot current values before the re-roll and append to the rejection log.
        current = ResolvedNumbers(values={b.param_key: b.value for b in w.bindings})
        w.rejected_attempts.append(current)

        # Build the rejected_attempts list to pass to the resolver: all prior
        # rejected entries plus the current attempt (which is now the latest rejection).
        all_rejected = [a.values for a in w.rejected_attempts]

        rationale = (
            input.feedback
            or "The user rejected the previous attempt. Produce a meaningfully different result for the same intent."
        )
        anthropic = deps.get_anthropic_client()
        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        resolved = anthropic.resolve_widget_params(
            op=op,
            intent=w.intent,
            rationale=rationale,
            starting_params=dict(node.params),
            image_context=ctx.model_dump(mode="json") if ctx is not None else {},
            session_id=doc.session_id,
            rejected_attempts=all_rejected,
        )

        # Write resolved values back through node params, canonical state, and bindings
        # so the image updates live and sliders track — same write-back as refine's
        # registry-op branch.
        for key, value in resolved.items():
            node.params[key] = value
            doc.set_param(node.layer_id, node.type, key, value)
            binding = next((b for b in w.bindings if b.param_key == key), None)
            if binding is not None:
                binding.value = value

        # If the widget carries a compound block, refresh anchor-1 for unlocked params
        # so the driver's "100" tracks the re-rolled values. Baseline stays.
        from app.tools.widgets.fused_compound import update_target_anchor
        update_target_anchor(w, resolved)

        w.revision += 1
        doc.update_widget(w)
        return _Output(widget=w.model_dump(mode="json", by_alias=True))
