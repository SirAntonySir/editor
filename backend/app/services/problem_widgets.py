"""Shared template-free problem-minting helper.

Both ``autonomous_suggestions`` and ``correct_problem`` route through here
(T3/T4 of feat/remove-fused-templates).  Given a list of :class:`Problem`
objects the helper:

1. Builds one mechanical plan entry per problem (ops = validated registry op
   ids from ``problem.suggested_ops``).
2. Calls ``anthropic.resolve_stack_params`` once for the whole batch.
3. Builds each widget via ``_build_widget_multi`` + ``_attach_fused_compound``.
4. Returns (problem, widget) pairs — **does not call doc.add_widget**.

``param_source`` is stamped:
  - ``"llm"``        when the resolver supplied explicit params for every op.
  - ``"llm_clamped"`` when any op fell back to ``clamp_op_params``.

No ``"midpoint"`` fallback: a resolver failure is journaled and the whole
batch returns ``[]`` (consistent with ``propose_stack``'s trust posture).
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from app.schemas.enriched_context import Problem
    from app.schemas.widget import Scope, Widget
    from app.state.document import SessionDocument


def _humanize(kind: str) -> str:
    """Convert a snake_case or camelCase problem kind to a title-style label.

    ``"clipped_highlights"`` → ``"Clipped highlights"``
    ``"underexposed_shadows"`` → ``"Underexposed shadows"``
    Mirrors ``_op_display`` from propose_stack but uses standard title-case:
    first word capitalised, remainder lowercase.
    """
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", kind)
    words = words.replace("-", " ").replace("_", " ")
    return words[:1].upper() + words[1:].lower()


def widget_op_signature(widget: Any) -> str:
    """Canonical dedup/dismissal key for a Widget — shared by the dismissal
    writer (delete_widget) and the autonomous suggestion reader so they
    always agree.

    Uses the op_id of every non-None node op, sorted, joined with '+'.
    Falls back to ``widget.op_id`` (the legacy single-op field) if no
    node-level op_ids are present (e.g. genfill widgets or very old sessions).
    """
    node_op_ids = [n.op_id for n in widget.nodes if n.op_id]
    if node_op_ids:
        return "+".join(sorted(node_op_ids))
    return widget.op_id or ""


async def resolve_problem_widgets(
    doc: "SessionDocument",
    problems: "list[Problem]",
    *,
    scope_for: "Callable[[Problem], Scope]",
    origin_kind: str,
    anthropic: Any,
    session_id: str,
    feedback: "dict[int, str] | None" = None,
) -> "list[tuple[Problem, Widget]]":
    """Mint widgets for a list of Problems via the registry-op path.

    Parameters
    ----------
    doc:
        The active ``SessionDocument``.  Used for ``get_image_context``,
        ``canonical``, and ``session_id``.
    problems:
        Problems to mint.  Each produces at most one widget.
    scope_for:
        Callable ``(problem) -> Scope`` — lets the caller decide the scope
        (e.g. named_region when a SAM mask exists, global otherwise).
    origin_kind:
        ``"mcp_autonomous"`` (suggestion pass) or ``"tool_invoked"``
        (correct-problem button).
    anthropic:
        Client with a ``resolve_stack_params`` method.
    session_id:
        For journaling.
    feedback:
        Optional mapping of problem INDEX (in the ``problems`` list) →
        feedback text to append to that entry's op rationale.  Keyed by
        index (not ``problem.kind``) so two problems of the same kind each
        get their own feedback.  Used by the verification retry path in
        ``autonomous_suggestions`` to steer the resolver after a first
        attempt failed the metric check.

    Returns
    -------
    list[tuple[Problem, Widget]]
        (problem, widget) pairs in plan order, not yet added to the document.
    """
    import asyncio

    from app.registry.loader import get_registry
    from app.schemas.widget import WidgetOrigin
    from app.services.event_journal import write_event
    from app.services.llm_context import image_context_for_llm
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    from app.tools.widgets.propose_stack import _attach_fused_compound, _build_widget_multi

    reg = get_registry()

    # --- Step 1: build plan entries, filter problems with no valid ops -------

    # index back to problems so we can get driver_label etc. after resolution
    plan_entries: list[dict] = []
    plan_index_to_problem: dict[int, "Problem"] = {}
    # Map plan entry index → original problem index (for feedback lookup)
    plan_index_to_problem_index: dict[int, int] = {}

    for problem_index, problem in enumerate(problems):
        valid_ops = [op_id for op_id in problem.suggested_ops if op_id in reg.ops]
        if not valid_ops:
            write_event(session_id, "proposal.health", {
                "stage": "problem_mint",
                "event": "resolve_failed",
                "reason": "no_valid_ops",
                "kind": problem.kind,
            })
            continue

        entry_index = len(plan_entries)
        plan_index_to_problem[entry_index] = problem
        plan_index_to_problem_index[entry_index] = problem_index
        # For kind="other" (top-up presets), display_label holds the preset's
        # human name — use it as the driver/name so the widget card shows the
        # preset display name rather than the generic "Other" label.
        label = problem.display_label if (problem.kind == "other" and problem.display_label) else _humanize(problem.kind)
        base_rationale = problem.description or problem.kind
        # feedback is keyed by problem index (not kind) to avoid collision when
        # two problems share the same kind.
        extra = (feedback or {}).get(problem_index)
        if extra:
            base_rationale = f"{base_rationale}. {extra}"
        entry: dict = {
            "widget_name": label,
            "driver_label": label,
            "category": None,
            "ops": [
                {
                    "op_id": op_id,
                    "rationale": base_rationale,
                    "starting_params": None,
                }
                for op_id in valid_ops
            ],
        }
        plan_entries.append(entry)

    if not plan_entries:
        return []

    # --- Step 2: one resolve_stack_params call for the whole batch -----------

    ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
    if ctx is None:
        write_event(session_id, "proposal.health", {
            "stage": "problem_mint",
            "event": "resolve_failed",
            "reason": "missing_context",
        })
        return []

    image_context = image_context_for_llm(
        ctx.model_dump(mode="json", by_alias=True),
    )

    # Determine the overall intent from the problems.
    intent = ", ".join(_humanize(p.kind) for p in plan_index_to_problem.values())

    # The wait_for guards the per-session write lock the tool registry holds
    # around callers (H19 audit deadlock): the SDK timeout bounds each attempt
    # and the resolver retries once, so 2× + margin covers the worst case.
    from app.config import get_app_config
    stack_timeout_s = get_app_config().runtime.anthropic_timeout_s * 2 + 5

    try:
        by_entry: dict[int, list[tuple[str, dict]]] = await asyncio.wait_for(
            asyncio.to_thread(
                anthropic.resolve_stack_params,
                plan_entries=plan_entries,
                intent=intent,
                image_context=image_context,
                registry=reg,
                session_id=session_id,
            ),
            timeout=stack_timeout_s,
        )
    except Exception as exc:  # noqa: BLE001 — includes asyncio.TimeoutError
        write_event(session_id, "proposal.health", {
            "stage": "problem_mint",
            "event": "resolver_failed",
            "detail": str(exc)[:500],
        })
        return []

    # --- Step 3: build widgets -----------------------------------------------

    from app.services.anthropic_client import clamp_op_params

    pairs: list[tuple["Problem", "Widget"]] = []

    for entry_index, entry in enumerate(plan_entries):
        problem = plan_index_to_problem[entry_index]
        scope = scope_for(problem)

        # image_node_layer_ids: same derivation as _handle_llm_path in propose_stack.
        image_node_layer_ids = (
            list(scope.root.layer_ids) if scope.root.kind == "image_node" else None
        )

        origin = WidgetOrigin(
            kind=origin_kind,
            prompt=None,
            parent_widget_id=None,
        )

        resolved_for_entry: dict[str, dict] = dict(by_entry.get(entry_index, []))

        ops_for_entry: list[tuple[str, dict]] = []
        any_clamped = False

        for op_entry in entry["ops"]:
            op_id = op_entry["op_id"]
            if op_id not in reg.ops:
                continue
            params = resolved_for_entry.get(op_id)
            if params is None:
                # Resolver omitted this op — fall back to clamp of starting_params.
                params = clamp_op_params(
                    reg.ops[op_id],
                    op_entry.get("starting_params") or {},
                )
                any_clamped = True
            ops_for_entry.append((op_id, params))

        if not ops_for_entry:
            continue

        # Use first layer id in image_node_layer_ids as layer_id, same as propose_stack.
        layer_id = image_node_layer_ids[0] if image_node_layer_ids else "legacy"

        widget = _build_widget_multi(
            widget_name=entry.get("widget_name"),
            category=entry.get("category"),
            ops=ops_for_entry,
            intent=_humanize(problem.kind),
            scope=scope,
            origin=origin,
            layer_id=layer_id,
            image_node_layer_ids=image_node_layer_ids,
            doc=doc,
        )

        driver_label: str | None = entry.get("driver_label")
        # force=True so tool_invoked-origin correct_problem widgets also get the driver.
        _attach_fused_compound(widget, doc, driver_label, force=True)

        # Stamp param_source for study instrumentation.
        widget.param_source = "llm_clamped" if any_clamped else "llm"

        # Propagate display_name from the problem if available.
        if problem.display_label:
            widget.display_name = problem.display_label

        pairs.append((problem, widget))

    return pairs
