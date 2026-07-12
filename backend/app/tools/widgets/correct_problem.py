"""correct_problem — the Info tab's "Correct" button.

The analysis pass surfaces Problems with suggested registry op ids
(``suggested_ops``); this tool is the one-click bridge from a listed problem
to a live correction: it resolves the problem's suggested ops against the
cached image context (the same grounded resolve the autonomous suggestions use)
and mints the widget directly onto the canvas.

Origin is ``tool_invoked`` — an explicit user action, so the frontend tethers
the widget immediately; it must never appear as a pending suggestion chip.
Dismissal rules are deliberately NOT consulted: the user just asked for this
specific correction by name.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownProblem(KeyError):
    pass


class _NoApplicableAdjustments(Exception):
    """Mapped to invalid_input in the envelope by the registry."""
    pass


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    problem_kind: str
    region_label: str | None = None
    layer_id: str = "legacy"


class _Output(BaseModel):
    widget: dict


class CorrectProblemTool(BackendTool[_Input, _Output]):
    name = "correct_problem"
    kind = "mutate"
    description = (
        "Resolve a detected problem's suggested registry ops against the "
        "cached image context and mint the correction widget onto the canvas. "
        "Backs the Info tab's per-problem 'Correct' button."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True,
        requires_image=True, requires_context=True,
    )
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return "Correct problem"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        from app.schemas.widget import Scope
        from app.services.problem_widgets import resolve_problem_widgets

        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        problems = getattr(ctx, "problems", None) or []
        problem = next(
            (
                p for p in problems
                if p.kind == input.problem_kind
                and (p.region_label or None) == (input.region_label or None)
            ),
            None,
        )
        if problem is None:
            raise _UnknownProblem(
                f"no analyzed problem {input.problem_kind!r}"
                f"{f' @ {input.region_label}' if input.region_label else ''}"
            )

        # Guard: if the problem carries no applicable registry ops, surface an
        # error rather than trying to mint an empty widget.
        from app.registry.loader import get_registry
        reg = get_registry()
        valid_ops = [op_id for op_id in (problem.suggested_ops or []) if op_id in reg.ops]
        if not valid_ops:
            raise _NoApplicableAdjustments(
                f"problem {input.problem_kind!r} has no applicable adjustments "
                f"(suggested_ops: {problem.suggested_ops!r})"
            )

        # Same scope rule as the autonomous mint: a region-local problem whose
        # SAM mask was precomputed keeps the named-region scope; otherwise the
        # correction applies to the whole layer.
        def _scope_for(p) -> "Scope":
            label = p.region_label
            if label and any(m.label == label for m in doc.masks.values()):
                return Scope.model_validate({"kind": "named_region", "label": label})
            return Scope.model_validate({"kind": "global"})

        anthropic = deps.get_anthropic_client()
        pairs = await resolve_problem_widgets(
            doc,
            [problem],
            scope_for=_scope_for,
            origin_kind="tool_invoked",
            anthropic=anthropic,
            session_id=doc.session_id,
        )

        if not pairs:
            raise _NoApplicableAdjustments(
                f"problem {input.problem_kind!r} has no applicable adjustments "
                f"(suggested_ops: {problem.suggested_ops!r})"
            )

        _problem_obj, widget = pairs[0]

        # Override layer_id on all nodes with the caller-supplied layer_id.
        for node in widget.nodes:
            node.layer_id = input.layer_id

        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json", by_alias=True))
