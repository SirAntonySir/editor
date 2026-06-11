"""Pick fused tools that fit the image's grade character and mint an
autonomous Widget per resolved suggestion. Extracted from the deleted
analyze_image mega-tool; called by the suggest_widgets MCP tool.
"""

from __future__ import annotations

import asyncio


async def mint_autonomous_suggestions(doc, ctx, anthropic, layer_id: str = "legacy") -> None:
    """For each high-severity Problem, run the suggested fused tool with
    origin.kind='mcp_autonomous'. Suggestions whose (fused_tool_id, scope)
    matches an existing dismissal rule are skipped.

    Every minted widget's nodes are stamped with ``layer_id`` (the frontend's
    real layer id) so the renderer applies them — the fused framework leaves
    nodes on the "legacy" default otherwise.

    Resolves run in parallel: selection (templates + dedup) is pure, fast,
    and runs first; then every pick fires its resolver concurrently. Each
    resolver makes a sync Anthropic call, so we route through
    ``asyncio.to_thread`` to get real wall-clock concurrency rather than
    serial waiting on the event loop."""

    def _stamp(widget) -> None:
        for node in widget.nodes:
            node.layer_id = layer_id
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

    templates = {t.id: t for t in all_fused_templates()}

    def _canonical_targets(template) -> set[tuple[str, str]]:
        """The `(node_type, param_key)` pairs the template will write to
        canonical. Used to detect KNOB collisions — two suggestions both
        binding `basic.saturation` produce two sliders fighting over the
        same canonical param, last-write-wins. Drop the later one."""
        node_types = {n.node_type for n in template.node_skeleton}
        result: set[tuple[str, str]] = set()
        for b in template.bindings_skeleton:
            node_id = b.target.node_id
            hint = node_id[2:] if node_id.startswith("n_") else node_id
            if hint in node_types:
                result.add((hint, b.target.param_key))
        return result

    def _scope_for(_problem) -> Scope:
        # Currently SAM is gated off (see _sam_enabled), so region masks
        # are not precomputed and a `named_region` scope has nothing to
        # apply through — the resulting widget shows on the canvas but
        # produces no pixel change. Force everything to global scope until
        # masks come back; the original region_label still lives in
        # `widget.reasoning` via the augment prompt, so the user can see
        # WHERE the problem was detected even when we can't restrict the
        # adjustment to that area yet.
        return Scope.model_validate({"kind": "global"})

    def _dismissed(fused_id: str, scope: Scope) -> bool:
        root = scope.root
        if root.kind == "global":
            sig = "global"
        elif root.kind == "named_region":
            sig = f"named_region:{root.label}"
        else:
            sig = f"mask:{root.mask_id}"
        for rule in doc.dismissals:
            if rule.fused_tool_id == fused_id and rule.scope_signature == sig:
                return True
        return False

    # Target band: aim for at least TARGET autonomous suggestions, but allow up
    # to MAX from the problem-driven pass if Claude flagged that many issues.
    TARGET_AUTONOMOUS_SUGGESTIONS = 3
    MAX_AUTONOMOUS_SUGGESTIONS = 5
    origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
    loop = asyncio.get_running_loop()

    initial_count = sum(
        1 for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.status == "active"
    )

    # Two-layer dedup, tracked across problem-driven + top-up passes:
    #   - `used_fused_ids` — no widget shares its fused_tool_id with another;
    #     prevents two identical templates landing at different scopes.
    #   - `used_targets`   — no two widgets bind to the same canonical
    #     `(node_type, param_key)`. Catches the saturation-triplet case
    #     where cast_correct, warm_grade, subject_pop, etc. all want the
    #     same `basic.saturation` knob — only the first wins; later
    #     candidates fall through to their next suggestion.
    used_fused_ids: set[str] = set()
    used_targets: set[tuple[str, str]] = set()

    async def _resolve(template, intent: str, scope: Scope):
        # Each fused template's `resolve()` is `async def` but internally
        # makes a SYNC Anthropic SDK call. Awaiting one on the event loop
        # blocks every other concurrent task — gather wouldn't actually
        # parallelise. Run each in its own worker thread so the concurrent
        # picks share wall-clock.
        try:
            return await asyncio.to_thread(
                _run_fused_tool_sync,
                run_fused_tool, template, intent, scope, ctx, anthropic, origin,
            )
        except Exception:
            return None

    # ---- Problem-driven pass: select first, resolve in parallel ----------
    # Selection is the part that needs to be sequential — each pick's dedup
    # decisions depend on previous picks' canonical targets. But selection
    # is pure registry lookups, microseconds total. The resolves are the
    # multi-second LLM calls — those fire concurrently.
    Pick = tuple  # (template, intent, scope, fused_id, targets)
    picks: list = []
    problem_budget = MAX_AUTONOMOUS_SUGGESTIONS - initial_count
    for problem in ctx.problems:
        if len(picks) >= problem_budget:
            break
        if problem.severity < 0.5:
            continue
        for tool_index, fused_id in enumerate(problem.suggested_fused_tools):
            if fused_id not in templates:
                continue
            if fused_id in used_fused_ids:
                continue
            template = templates[fused_id]
            targets = _canonical_targets(template)
            if targets & used_targets:
                continue
            scope = _scope_for(problem)
            if _dismissed(fused_id, scope):
                continue
            # Intent text: when we use the problem's PRIMARY suggestion the
            # tool was hand-picked to match the problem, so naming the widget
            # after the problem reads naturally ("strong color cast"). When
            # we fall through to a later suggestion the tool no longer
            # matches the problem name, so we label it after the TOOL
            # instead. Problem context still lives in `widget.reasoning`.
            intent = (
                problem.kind.replace("_", " ") if tool_index == 0 else template.label
            )
            picks.append(Pick((template, intent, scope, fused_id, targets)))
            used_fused_ids.add(fused_id)
            used_targets |= targets
            break  # one per problem

    resolved = await asyncio.gather(
        *[_resolve(t, i, s) for (t, i, s, _fid, _tgts) in picks]
    )
    successful = 0
    for widget in resolved:
        if widget is None:
            continue
        _stamp(widget)
        doc.add_widget(widget)
        successful += 1

    # ---- Top up via image-character match only when needed --------------
    if initial_count + successful >= TARGET_AUTONOMOUS_SUGGESTIONS:
        return

    already_used = {
        w.op_id for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.op_id
    }
    dismissed_global = {
        rule.fused_tool_id for rule in doc.dismissals
        if rule.scope_signature == "global"
    }
    needed = TARGET_AUTONOMOUS_SUGGESTIONS - (initial_count + successful)
    exclude = list(already_used | dismissed_global)
    candidates = await loop.run_in_executor(
        None,
        lambda: anthropic.suggest_fused_tools_for_character(
            grade_character=ctx.grade_character,
            lighting=ctx.lighting,
            dominant_tones=ctx.dominant_tones,
            subjects=ctx.subjects,
            exclude=exclude,
            n=needed,
            session_id=doc.session_id,
        ),
    )

    global_scope = Scope.model_validate({"kind": "global"})
    topup_picks: list = []
    for fused_id in candidates:
        if len(topup_picks) >= needed:
            break
        if fused_id not in templates or fused_id in already_used:
            continue
        template = templates[fused_id]
        targets = _canonical_targets(template)
        if targets & used_targets:
            continue
        if _dismissed(fused_id, global_scope):
            continue
        topup_picks.append((template, template.label, global_scope, fused_id, targets))
        used_targets |= targets
        already_used.add(fused_id)

    topup_resolved = await asyncio.gather(
        *[_resolve(t, i, s) for (t, i, s, _fid, _tgts) in topup_picks]
    )
    for widget in topup_resolved:
        if widget is None:
            continue
        _stamp(widget)
        doc.add_widget(widget)


def _run_fused_tool_sync(run_fused_tool, template, intent, scope, ctx, anthropic, origin):
    """Bridge from a worker thread back into `run_fused_tool` (async). Each
    thread spins its own event loop via `asyncio.run` — the Anthropic SDK
    call inside the resolver blocks that loop, not the caller's. Cheap:
    loop setup is ~1ms vs the multi-second LLM round-trip we're protecting."""
    return asyncio.run(
        run_fused_tool(
            template,
            intent=intent,
            scope=scope,
            ctx=ctx,
            prior=None,
            instruction=None,
            anthropic=anthropic,
            origin=origin,
        )
    )
