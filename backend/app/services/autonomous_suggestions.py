"""Pick fused tools that fit the image's grade character and mint an
autonomous Widget per resolved suggestion. Extracted from the deleted
analyze_image mega-tool; called by the suggest_widgets MCP tool.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


def _journal(doc, payload: dict) -> None:
    """Journal an autonomous-pass decision (proposal.health, stage=autonomous).
    Telemetry must never break suggestion minting, so failures only warn."""
    try:
        from app.services.event_journal import write_event
        write_event(doc.session_id, "proposal.health", {"stage": "autonomous", **payload})
    except Exception:  # noqa: BLE001
        logger.warning("proposal.health journal write failed", exc_info=True)


async def mint_autonomous_suggestions(
    doc, ctx, anthropic, layer_id: str = "legacy", object_label: str | None = None,
) -> None:
    """For each high-severity Problem, run the suggested fused tool with
    origin.kind='mcp_autonomous'. Suggestions whose (fused_tool_id, scope)
    matches an existing dismissal rule are skipped.

    Every minted widget's nodes are stamped with ``layer_id`` (the frontend's
    real layer id) so the renderer applies them — the fused framework leaves
    nodes on the "legacy" default otherwise.

    ``object_label`` puts the pass in OBJECT MODE — suggest-on-a-cutout. The
    extracted node inherits the SOURCE image's context, so `ctx.problems`
    still describes the whole photo; here only problems whose region matches
    the object mint, and every minted scope is forced global: the cutout IS
    the region, so a named_region scope would re-trigger the selection
    chooser on an already-selected image.

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

    def _scope_for(problem) -> Scope:
        """Element-local problems get the region's scope when its SAM mask
        was precomputed (`precompute_regions` registers one MaskRecord per
        candidate region, labelled with the region label, before the
        suggestion phase). Same scope shape the user-prompt path ships —
        anchor chips, `named_region:<label>` dismissal signatures, and the
        fused skin-safety check all engage unchanged. Rendering still
        applies globally until the canonical projection carries scope
        (step 2: scope-aware canonical); the scope recorded here is what
        makes that step retroactively correct for existing widgets.

        No resolvable mask → global, journaled as scope_fallback so the
        degradation is measurable. Whole-image problems stay global."""
        label = problem.region_label
        if not label:
            return Scope.model_validate({"kind": "global"})
        if any(m.label == label for m in doc.masks.values()):
            return Scope.model_validate({"kind": "named_region", "label": label})
        _journal(doc, {"event": "scope_fallback", "problem": problem.kind,
                       "region_label": label,
                       "detail": "no precomputed mask for region"})
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
    # Minimum severity to mint a problem-driven suggestion. Lowered from 0.5
    # once severities became mechanically grounded (severity_grounding.py): a
    # measured defect now carries an evidence-based floor, so the gate can sit
    # lower without admitting noise — the floor, not the gate, is what stops a
    # conservative LLM score from hiding a real problem.
    SEVERITY_GATE = 0.4
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

    # Per-resolve timeout — without it, one hung Anthropic call would
    # park the gather (and the surrounding write-lock held by the
    # suggest_widgets tool) forever, freezing the session. Falls back
    # to `anthropic_timeout_s` so the bound matches the SDK's own.
    from app.config import get_app_config
    resolve_timeout_s = get_app_config().runtime.anthropic_timeout_s

    async def _resolve(template, intent: str, scope: Scope):
        # Each fused template's `resolve()` is `async def` but internally
        # makes a SYNC Anthropic SDK call. Awaiting one on the event loop
        # blocks every other concurrent task — gather wouldn't actually
        # parallelise. Run each in its own worker thread so the concurrent
        # picks share wall-clock.
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(
                    _run_fused_tool_sync,
                    run_fused_tool, template, intent, scope, ctx, anthropic, origin,
                    doc.session_id,
                ),
                timeout=resolve_timeout_s,
            )
        except asyncio.TimeoutError:
            _journal(doc, {"event": "resolve_failed", "tool": template.id,
                           "detail": f"timeout after {resolve_timeout_s}s"})
            return None
        except Exception as exc:  # noqa: BLE001
            _journal(doc, {"event": "resolve_failed", "tool": template.id,
                           "detail": str(exc)[:500]})
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
        if problem.kind == "other":
            # Escape-hatch observation: no tool mapping exists, so minting a
            # widget would be noise — but the observation is exactly the data
            # that grows the vocabulary. Journal it regardless of severity.
            _journal(doc, {"event": "observation", "problem": "other",
                           "severity": problem.severity,
                           "label": problem.display_label,
                           "detail": problem.description})
            continue
        if problem.severity < SEVERITY_GATE:
            _journal(doc, {"event": "suggestion_skipped", "reason": "severity_gate",
                           "problem": problem.kind, "severity": problem.severity})
            continue
        if object_label is not None:
            # Object mode: only THIS object's problems mint. Whole-image
            # problems (and other regions') were already suggested on the
            # source — repeating them on the cutout is the "whole image
            # again" noise the flow exists to avoid.
            if (problem.region_label or "").strip().lower() != object_label.strip().lower():
                _journal(doc, {"event": "suggestion_skipped", "reason": "object_mismatch",
                               "problem": problem.kind,
                               "region_label": problem.region_label,
                               "object_label": object_label})
                continue
        for tool_index, fused_id in enumerate(problem.suggested_fused_tools):
            if fused_id not in templates:
                _journal(doc, {"event": "suggestion_skipped", "reason": "unknown_template",
                               "problem": problem.kind, "tool": fused_id})
                continue
            if fused_id in used_fused_ids:
                _journal(doc, {"event": "suggestion_skipped", "reason": "duplicate_fused_id",
                               "problem": problem.kind, "tool": fused_id})
                continue
            template = templates[fused_id]
            targets = _canonical_targets(template)
            if targets & used_targets:
                _journal(doc, {"event": "suggestion_skipped", "reason": "knob_collision",
                               "problem": problem.kind, "tool": fused_id})
                continue
            # Object mode: the cutout is the whole layer — always global.
            scope = (
                Scope.model_validate({"kind": "global"})
                if object_label is not None
                else _scope_for(problem)
            )
            if _dismissed(fused_id, scope):
                _journal(doc, {"event": "suggestion_skipped", "reason": "dismissed",
                               "problem": problem.kind, "tool": fused_id})
                continue
            # Intent text: when we use the problem's PRIMARY suggestion the
            # tool was hand-picked to match the problem, so naming the widget
            # after the problem reads naturally ("strong color cast"). When
            # we fall through to a later suggestion the tool no longer
            # matches the problem name, so we label it after the TOOL
            # instead. Problem context still lives in `widget.reasoning`.
            # `intent` stays canonical (analytics key); the augment pass's
            # free-text display_label becomes the card title the user reads.
            intent = (
                problem.kind.replace("_", " ") if tool_index == 0 else template.label
            )
            picks.append(Pick((template, intent, scope, fused_id, targets,
                               problem.display_label)))
            used_fused_ids.add(fused_id)
            used_targets |= targets
            break  # one per problem

    resolved = await asyncio.gather(
        *[_resolve(t, i, s) for (t, i, s, _fid, _tgts, _lbl) in picks]
    )
    successful = 0
    for pick, widget in zip(picks, resolved):
        if widget is None:
            continue
        widget.display_name = pick[5]  # image-specific label; None → UI falls back to intent
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
    try:
        candidates = await asyncio.wait_for(
            loop.run_in_executor(
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
            ),
            timeout=resolve_timeout_s,
        )
    except asyncio.TimeoutError:
        # Top-up is best-effort — failing it just leaves fewer
        # autonomous suggestions, not a broken session.
        _journal(doc, {"event": "topup_candidates_failed",
                       "detail": f"timeout after {resolve_timeout_s}s"})
        candidates = []
    else:
        _journal(doc, {"event": "topup_requested", "needed": needed,
                       "candidates": list(candidates)})

    global_scope = Scope.model_validate({"kind": "global"})
    topup_picks: list = []
    for fused_id in candidates:
        if len(topup_picks) >= needed:
            break
        if fused_id not in templates or fused_id in already_used:
            _journal(doc, {"event": "suggestion_skipped", "tool": fused_id,
                           "reason": ("unknown_template" if fused_id not in templates
                                      else "duplicate_fused_id")})
            continue
        template = templates[fused_id]
        targets = _canonical_targets(template)
        if targets & used_targets:
            _journal(doc, {"event": "suggestion_skipped", "reason": "knob_collision",
                           "tool": fused_id})
            continue
        if _dismissed(fused_id, global_scope):
            _journal(doc, {"event": "suggestion_skipped", "reason": "dismissed",
                           "tool": fused_id})
            continue
        topup_picks.append((template, template.label, global_scope, fused_id, targets))
        used_targets |= targets
        already_used.add(fused_id)

    topup_resolved = await asyncio.gather(
        *[_resolve(t, i, s) for (t, i, s, _fid, _tgts) in topup_picks]
    )
    for pick, widget in zip(topup_picks, topup_resolved):
        if widget is None:
            continue
        widget.display_name = pick[0].label  # template label (no problem to name it after)
        _stamp(widget)
        doc.add_widget(widget)


def _run_fused_tool_sync(run_fused_tool, template, intent, scope, ctx, anthropic, origin, session_id):
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
            session_id=session_id,
        )
    )
