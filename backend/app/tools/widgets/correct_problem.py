"""correct_problem — the Info tab's "Correct" button.

The analysis pass surfaces Problems with suggested fused tools; this tool is
the one-click bridge from a listed problem to a live correction: it resolves
the problem's PRIMARY suggested fused template against the cached image
context (the same grounded resolve the autonomous suggestions use) and mints
the widget directly onto the canvas.

Origin is `tool_invoked` — an explicit user action, so the frontend tethers
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
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool


class _UnknownProblem(KeyError):
    pass


class _NoTemplate(Exception):
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
        "Resolve a detected problem's primary suggested fused tool against the "
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
        from app.schemas.widget import Scope, WidgetOrigin

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

        templates = {t.id: t for t in all_fused_templates()}
        template = next(
            (templates[fid] for fid in problem.suggested_fused_tools if fid in templates),
            None,
        )
        if template is None:
            raise _NoTemplate(
                f"problem {input.problem_kind!r} has no known fused template "
                f"(suggested: {problem.suggested_fused_tools})"
            )

        # Same scope rule as the autonomous mint: a region-local problem whose
        # SAM mask was precomputed keeps the named-region scope; otherwise the
        # correction applies to the whole layer.
        label = problem.region_label
        if label and any(m.label == label for m in doc.masks.values()):
            scope = Scope.model_validate({"kind": "named_region", "label": label})
        else:
            scope = Scope.model_validate({"kind": "global"})

        intent = problem.kind.replace("_", " ")
        anthropic = deps.get_anthropic_client()
        widget = await run_fused_tool(
            template, intent=intent, scope=scope, ctx=ctx,
            prior=None, instruction=None, anthropic=anthropic,
            # tool_invoked: explicit user action → the frontend tethers it
            # straight onto the canvas (never a pending chip).
            origin=WidgetOrigin(kind="tool_invoked"),
            session_id=doc.session_id,
        )
        widget.display_name = problem.display_label or None
        for node in widget.nodes:
            node.layer_id = input.layer_id
        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json", by_alias=True))
