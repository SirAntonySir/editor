"""Pick registry ops that fit the image's grade character and mint an
autonomous Widget per resolved suggestion via the shared problem-minting
helper.  Extracted from the deleted analyze_image mega-tool; called by
the suggest_widgets MCP tool.

Template references have been removed (T3 of feat/remove-fused-templates):
suggestions are now driven by ``problem.suggested_ops`` (registry op ids)
and the dedup/dismissal keys are op-signature strings.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# Problem kinds that describe a corrective NEED (something is wrong and should
# be fixed), as opposed to judgement/stylistic observations. Used to suppress
# the aesthetic image-character top-up while any of these is still unresolved —
# a damaged image gets corrections or fewer cards, never decoration.
_CORRECTIVE_KINDS = frozenset({
    "strong_color_cast", "crushed_shadows", "clipped_highlights",
    "low_contrast", "local_underexposure", "local_overexposure",
    "uneven_white_balance", "noisy_shadows",
})
# A corrective problem at or above this severity blocks the top-up even if it
# sits just under the mint gate — the point is "don't decorate a broken image".
_OPEN_CORRECTIVE_SEVERITY = 0.35

# Minimum severity to mint a problem-driven suggestion. Lowered from 0.5 once
# severities became mechanically grounded (severity_grounding.py): a measured
# defect now carries an evidence-based floor, so the gate can sit lower without
# admitting noise — the floor, not the gate, is what stops a conservative LLM
# score from hiding a real problem.
SEVERITY_GATE = 0.4


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
    """For each high-severity Problem, resolve the suggested registry ops and
    mint an autonomous Widget.  Suggestions whose op-signature + scope matches
    an existing dismissal rule are skipped.

    Every minted widget's nodes are stamped with ``layer_id`` (the frontend's
    real layer id) so the renderer applies them.

    ``object_label`` puts the pass in OBJECT MODE — suggest-on-a-cutout. The
    extracted node inherits the SOURCE image's context, so `ctx.problems`
    still describes the whole photo; here only problems whose region matches
    the object mint, and every minted scope is forced global: the cutout IS
    the region, so a named_region scope would re-trigger the selection
    chooser on an already-selected image.
    """
    from app.registry.loader import get_registry
    from app.schemas.widget import Scope, WidgetOrigin  # noqa: F401 (Scope used below)
    from app.services.problem_widgets import resolve_problem_widgets

    reg = get_registry()

    def _op_sig(op_ids: list[str]) -> str:
        """Canonical dedup/dismissal key for a set of ops."""
        return "+".join(sorted(op_ids))

    def _canonical_targets_for_ops(op_ids: list[str]) -> set[tuple[str, str]]:
        """The ``(node_type, param_key)`` pairs these ops will write.
        Used to detect KNOB collisions — two suggestions binding the same
        canonical param produce two sliders fighting over the same value;
        drop the later one."""
        result: set[tuple[str, str]] = set()
        for op_id in op_ids:
            op = reg.ops.get(op_id)
            if op is None:
                continue
            node_type = op.engine.node_type
            for param_key in op.params:
                result.add((node_type, param_key))
        return result

    def _scope_for(problem) -> "Scope":
        """Element-local problems get the region's scope when its SAM mask
        was precomputed.  No resolvable mask → global, journaled as
        scope_fallback.  Whole-image problems stay global."""
        label = problem.region_label
        if not label:
            return Scope.model_validate({"kind": "global"})
        if any(m.label == label for m in doc.masks.values()):
            return Scope.model_validate({"kind": "named_region", "label": label})
        _journal(doc, {"event": "scope_fallback", "problem": problem.kind,
                       "region_label": label,
                       "detail": "no precomputed mask for region"})
        return Scope.model_validate({"kind": "global"})

    def _dismissed(op_sig: str, scope: "Scope") -> bool:
        root = scope.root
        if root.kind == "global":
            sig = "global"
        elif root.kind == "named_region":
            sig = f"named_region:{root.label}"
        else:
            sig = f"mask:{root.mask_id}"
        for rule in doc.dismissals:
            if rule.fused_tool_id == op_sig and rule.scope_signature == sig:
                return True
        return False

    # Target band: aim for at least TARGET autonomous suggestions, but allow up
    # to MAX from the problem-driven pass if Claude flagged that many issues.
    TARGET_AUTONOMOUS_SUGGESTIONS = 3
    MAX_AUTONOMOUS_SUGGESTIONS = 5

    from app.config import get_app_config
    resolve_timeout_s = get_app_config().runtime.anthropic_timeout_s

    initial_count = sum(
        1 for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.status == "active"
    )

    # Two-layer dedup, tracked across problem-driven + top-up passes:
    #   - `used_op_sigs`  — no widget shares its op-signature with another;
    #     prevents two identical op-sets at different scopes.
    #   - `used_targets`  — no two widgets bind to the same canonical
    #     (node_type, param_key). Catches the saturation-triplet case.
    used_op_sigs: set[str] = set()
    used_targets: set[tuple[str, str]] = set()

    # ---- Problem-driven pass: select first, resolve in batch ----------------
    # Selection is sequential (dedup decisions depend on previous picks);
    # resolution is ONE batch call to resolve_problem_widgets.
    # Single-batch design is per spec §5.2 — a whole-call resolver failure
    # mints nothing this pass (journaled tool:"batch"); per-op omissions still
    # mint via clamp fallback.

    # Pick = (problem, valid_ops, op_sig, targets, scope)
    picks: list[tuple] = []
    problem_budget = MAX_AUTONOMOUS_SUGGESTIONS - initial_count

    for problem in ctx.problems:
        if len(picks) >= problem_budget:
            break
        if problem.kind == "other":
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
            if (problem.region_label or "").strip().lower() != object_label.strip().lower():
                _journal(doc, {"event": "suggestion_skipped", "reason": "object_mismatch",
                               "problem": problem.kind,
                               "region_label": problem.region_label,
                               "object_label": object_label})
                continue

        # `suggested_ops` is treated as ONE composite fix (spec §4/§5.2) — on
        # knob-collision the whole problem is dropped; there is deliberately no
        # per-op fallthrough (the old per-template fallback semantics).
        valid_ops = [op_id for op_id in problem.suggested_ops if op_id in reg.ops]
        if not valid_ops:
            _journal(doc, {"event": "suggestion_skipped", "reason": "no_valid_ops",
                           "problem": problem.kind})
            continue

        op_sig = _op_sig(valid_ops)
        if op_sig in used_op_sigs:
            _journal(doc, {"event": "suggestion_skipped", "reason": "duplicate_op_sig",
                           "problem": problem.kind, "tool": op_sig})
            continue

        targets = _canonical_targets_for_ops(valid_ops)
        if targets & used_targets:
            _journal(doc, {"event": "suggestion_skipped", "reason": "knob_collision",
                           "problem": problem.kind, "tool": op_sig})
            continue

        scope = (
            Scope.model_validate({"kind": "global"})
            if object_label is not None
            else _scope_for(problem)
        )
        if _dismissed(op_sig, scope):
            _journal(doc, {"event": "suggestion_skipped", "reason": "dismissed",
                           "problem": problem.kind, "tool": op_sig})
            continue

        picks.append((problem, valid_ops, op_sig, targets, scope))
        used_op_sigs.add(op_sig)
        used_targets |= targets

    # Resolve all picked problems in one batch call.
    pairs_by_pick: list = [None] * len(picks)
    if picks:
        picked_problems = [p[0] for p in picks]
        # scope_for wrapper that returns the pre-computed scope from the pick
        pick_scope_map = {id(p[0]): p[4] for p in picks}

        def _scope_for_picked(problem):
            return pick_scope_map[id(problem)]

        try:
            batch_pairs = await asyncio.wait_for(
                resolve_problem_widgets(
                    doc, picked_problems,
                    scope_for=_scope_for_picked,
                    origin_kind="mcp_autonomous",
                    anthropic=anthropic,
                    session_id=doc.session_id,
                ),
                timeout=resolve_timeout_s * 2 + 5,
            )
        except Exception as exc:  # noqa: BLE001
            _journal(doc, {"event": "resolve_failed", "tool": "batch",
                           "detail": str(exc)[:500]})
            batch_pairs = []

        # Map resolved (problem, widget) pairs back to picks by problem identity.
        # resolve_problem_widgets returns pairs in plan order; problems that had
        # no valid ops are dropped, so we match by problem identity (id()) rather
        # than positional index to avoid silent mis-binding.
        pick_problem_to_index = {id(p[0]): i for i, p in enumerate(picks)}
        for prob, widget in batch_pairs:
            idx = pick_problem_to_index.get(id(prob))
            if idx is not None:
                pairs_by_pick[idx] = (prob, widget)

    # Verification + mint.
    successful = 0
    minted_problem_ids: set[int] = set()

    for i, pick in enumerate(picks):
        problem, valid_ops, op_sig, _targets, scope = pick
        pair = pairs_by_pick[i]
        if pair is None:
            continue
        _prob, widget = pair

        widget = await _verify_corrective(
            doc, anthropic, op_sig, scope, problem, widget,
            resolve_timeout_s, resolve_problem_widgets,
        )

        # Layer stamp: _build_widget_multi sets layer_id from scope; override
        # to the caller-supplied layer_id (matches the pre-rewrite _stamp).
        for node in widget.nodes:
            node.layer_id = layer_id

        doc.add_widget(widget)
        successful += 1
        minted_problem_ids.add(id(problem))

    # ---- Top up via image-character match only when needed ------------------
    if initial_count + successful >= TARGET_AUTONOMOUS_SUGGESTIONS:
        return

    # Never decorate a broken image: if any corrective problem is still
    # unresolved, suppress the aesthetic top-up.
    def _relevant(problem) -> bool:
        if object_label is None:
            return True
        return (problem.region_label or "").strip().lower() == object_label.strip().lower()

    open_corrective = any(
        p.kind in _CORRECTIVE_KINDS
        and p.severity >= _OPEN_CORRECTIVE_SEVERITY
        and _relevant(p)
        and id(p) not in minted_problem_ids
        for p in ctx.problems
    )
    if open_corrective:
        _journal(doc, {"event": "topup_skipped", "reason": "open_corrective_problems"})
        return

    # Build already_used_sigs as op SIGNATURES of existing/minted widgets.
    # Using widget.nodes[*].op_id (not w.op_id which is only the first op's id)
    # gives the correct multi-op canonical signature so the dedup is in the same
    # namespace as preset op signatures computed below.
    already_used_sigs: set[str] = set()
    for w in doc.widgets.values():
        if w.origin.kind == "mcp_autonomous" and w.status == "active":
            node_op_ids = [n.op_id for n in w.nodes if n.op_id]
            if node_op_ids:
                already_used_sigs.add(_op_sig(node_op_ids))
    # Include problem-pass op sigs (already tracked in used_op_sigs).
    already_used_sigs |= used_op_sigs

    dismissed_global = {
        rule.fused_tool_id for rule in doc.dismissals
        if rule.scope_signature == "global"
    }
    needed = TARGET_AUTONOMOUS_SUGGESTIONS - (initial_count + successful)

    # Build the exclude list as PRESET IDs for suggest_fused_tools_for_character,
    # which filters its catalog by preset id. We include preset ids whose op
    # signature is already in already_used_sigs plus globally-dismissed preset ids.
    # This is a best-effort hint to the LLM — the authoritative dedup gate is the
    # local op-signature check in the candidate loop below (same namespace as
    # problem-pass sigs). If a preset slips through the hint, the sig check catches
    # it; if a valid preset was excluded needlessly, no harm done.
    used_preset_ids: set[str] = set()
    for pid, preset in reg.presets.items():
        preset_op_ids = [o.op_id for o in preset.ops if o.op_id in reg.ops]
        if preset_op_ids:
            sig = _op_sig(preset_op_ids)
            if sig in already_used_sigs:
                used_preset_ids.add(pid)
    exclude = list(used_preset_ids | dismissed_global)

    try:
        candidates = await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(
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
        _journal(doc, {"event": "topup_candidates_failed",
                       "detail": f"timeout after {resolve_timeout_s}s"})
        candidates = []
    else:
        _journal(doc, {"event": "topup_requested", "needed": needed,
                       "candidates": list(candidates)})

    global_scope = Scope.model_validate({"kind": "global"})

    # Build synthetic problems from preset ops for the top-up batch.
    from app.schemas.enriched_context import Problem as _Problem
    topup_picks: list[tuple] = []  # (preset_id, preset, problem_like)

    for preset_id in candidates:
        if len(topup_picks) >= needed:
            break
        preset = reg.presets.get(preset_id)
        if preset is None:
            _journal(doc, {"event": "suggestion_skipped", "tool": preset_id,
                           "reason": "unknown_preset"})
            continue
        preset_op_ids = [o.op_id for o in preset.ops if o.op_id in reg.ops]
        if not preset_op_ids:
            _journal(doc, {"event": "suggestion_skipped", "tool": preset_id,
                           "reason": "no_valid_ops"})
            continue
        # Dedup by op signature — same namespace as problem-pass sigs.
        preset_sig = _op_sig(preset_op_ids)
        if preset_sig in already_used_sigs:
            _journal(doc, {"event": "suggestion_skipped", "tool": preset_id,
                           "reason": "duplicate_op_sig"})
            continue
        targets = _canonical_targets_for_ops(preset_op_ids)
        if targets & used_targets:
            _journal(doc, {"event": "suggestion_skipped", "reason": "knob_collision",
                           "tool": preset_id})
            continue
        if _dismissed(preset_sig, global_scope):
            _journal(doc, {"event": "suggestion_skipped", "reason": "dismissed",
                           "tool": preset_id})
            continue
        # Synthesize a minimal Problem so resolve_problem_widgets can build the entry.
        synthetic_problem = _Problem(
            kind="other",  # top-up is aesthetic, not corrective
            severity=1.0,  # gate already passed (candidate selection)
            suggested_ops=preset_op_ids,
            display_label=preset.display_name,
            description=preset.description,
        )
        topup_picks.append((preset_id, preset, synthetic_problem))
        used_targets |= targets
        already_used_sigs.add(preset_sig)

    if topup_picks:
        topup_problems = [p[2] for p in topup_picks]

        def _topup_scope(_p):
            return global_scope

        try:
            topup_pairs = await asyncio.wait_for(
                resolve_problem_widgets(
                    doc, topup_problems,
                    scope_for=_topup_scope,
                    origin_kind="mcp_autonomous",
                    anthropic=anthropic,
                    session_id=doc.session_id,
                ),
                timeout=resolve_timeout_s * 2 + 5,
            )
        except Exception as exc:  # noqa: BLE001
            _journal(doc, {"event": "resolve_failed", "tool": "topup_batch",
                           "detail": str(exc)[:500]})
            topup_pairs = []

        # Match pairs back to picks by synthetic_problem identity (safe since
        # resolve_problem_widgets returns pairs in plan order and skipped
        # problems are dropped rather than emitting None placeholders).
        topup_problem_to_pick: dict[int, tuple] = {
            id(p[2]): p for p in topup_picks
        }
        for prob, widget in topup_pairs:
            pick = topup_problem_to_pick.get(id(prob))
            if pick is None or widget is None:
                continue
            _pid, preset, _sp = pick
            # Top-up display name comes from the preset label.
            widget.display_name = preset.display_name
            for node in widget.nodes:
                node.layer_id = layer_id
            doc.add_widget(widget)


async def _verify_corrective(doc, anthropic, op_sig: str, scope, problem, widget,
                              resolve_timeout_s: float, resolve_problem_widgets):
    """For a corrective suggestion, check that applying its params actually
    moves the problem's mechanical metric the right way (CPU preview +
    cheap-pass re-measure).  On failure, re-resolve ONCE with feedback and
    keep the retry only if it verifies.  Best-effort: any error, or an
    unverifiable/unsupported widget, returns the widget unchanged."""
    if problem.kind not in _CORRECTIVE_KINDS:
        return widget
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    def _measure(w):
        from app.services.suggestion_verification import measure_and_verify
        image_bytes = doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID)
        mime = doc.get_mime_type(DEFAULT_IMAGE_NODE_ID)
        return measure_and_verify(problem, image_bytes, mime, w, max_dim=384)

    try:
        result = await asyncio.to_thread(_measure, widget)
    except Exception as exc:  # noqa: BLE001
        _journal(doc, {"event": "verify_error", "tool": op_sig,
                       "problem": problem.kind, "detail": str(exc)[:300]})
        return widget
    if result is None:
        _journal(doc, {"event": "verify_skipped", "reason": "unsupported_ops",
                       "tool": op_sig, "problem": problem.kind})
        return widget
    if result.improved:
        _journal(doc, {"event": "verify_ok", "tool": op_sig,
                       "problem": problem.kind, "metric": result.metric,
                       "before": round(result.before, 4), "after": round(result.after, 4)})
        return widget

    _journal(doc, {"event": "verify_failed", "tool": op_sig,
                   "problem": problem.kind, "metric": result.metric,
                   "before": round(result.before, 4), "after": round(result.after, 4)})
    feedback_text = (
        f"A prior attempt moved {result.metric} from {result.before:.3f} to "
        f"{result.after:.3f}, which does NOT correct the {problem.kind.replace('_', ' ')}. "
        f"Apply a stronger correction in the right direction."
    )

    pick_scope_map = {id(problem): scope}

    def _scope_for_retry(p):
        return pick_scope_map[id(p)]

    try:
        # feedback keyed by problem index (0 — singleton list passed).
        retry_pairs = await asyncio.wait_for(
            resolve_problem_widgets(
                doc, [problem],
                scope_for=_scope_for_retry,
                origin_kind="mcp_autonomous",
                anthropic=anthropic,
                session_id=doc.session_id,
                feedback={0: feedback_text},
            ),
            timeout=resolve_timeout_s * 2 + 5,
        )
    except Exception:  # noqa: BLE001
        return widget

    retry = retry_pairs[0][1] if retry_pairs else None
    if retry is None:
        return widget

    try:
        retry_result = await asyncio.to_thread(_measure, retry)
    except Exception:  # noqa: BLE001
        return widget
    if retry_result is not None and retry_result.improved:
        _journal(doc, {"event": "verify_retry_ok", "tool": op_sig,
                       "problem": problem.kind, "metric": retry_result.metric,
                       "before": round(retry_result.before, 4),
                       "after": round(retry_result.after, 4)})
        return retry
    _journal(doc, {"event": "verify_retry_failed", "tool": op_sig,
                   "problem": problem.kind})
    return widget
