from __future__ import annotations

import logging
import uuid
from abc import ABC
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    ControlType,
    NodeParamTarget,
    ParamValue,
    ResolvedNumbers,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)

logger = logging.getLogger(__name__)


class ResolverError(RuntimeError):
    pass


class ParamRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min: float
    max: float
    step: float
    skin_safe_max: float | None = None


class NodeSkeleton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_type: str
    fixed_params: dict[str, ParamValue] = Field(default_factory=dict)
    tunable_param_keys: list[str] = Field(default_factory=list)


class BindingSkeleton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    param_key: str
    label: str
    control_type: ControlType
    control_schema: ControlSchema  # renamed from `schema` for consistency with ControlBinding
    target: NodeParamTarget
    tunable_default: bool = True


def _serialize_for_payload(value: Any) -> Any:
    """JSON-friendly dump of a context attribute. Pydantic models → model_dump,
    lists/tuples → recursive serialise, scalars pass through."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", by_alias=True)
    if isinstance(value, (list, tuple)):
        return [_serialize_for_payload(v) for v in value]
    return value


class FusedToolTemplate(ABC):
    id: str
    label: str
    description: str
    typical_use: str
    node_skeleton: list[NodeSkeleton]
    bindings_skeleton: list[BindingSkeleton]
    preview: dict[str, Any]
    requires_scope: Literal["any", "non_global", "named_region", "skin_safe"]
    param_envelope: dict[str, ParamRange]
    safety: dict[str, Any]
    context_inputs: list[str]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        """Default resolver: numeric-values-only schema generated from
        `param_envelope`, prompt payload assembled from `context_inputs`.

        `context_inputs` entries take two shapes:
          - `"field"`  → flat attr on ctx; emitted as `summary[field] = ctx.field`.
          - `"container.field"`  → entries of `ctx.container` (a list) sliced to
            `{label, field, ...}` per entry. Multiple dotted keys sharing the
            same container are grouped, so the LLM sees one list per container
            with all the requested fields side-by-side.

        Subclasses override only when they need a non-numeric schema (e.g.
        curve points) or unusual prompt shaping that isn't expressible via
        `context_inputs`. Adding a `_RESPONSE_SCHEMA` constant + an override
        that just reformats `context_inputs` is a code smell — extend the
        base resolver instead."""
        required_keys = list(self.param_envelope.keys())

        # The envelope MUST reach the model. Telemetry on real sessions
        # (2026-07-02) showed every resolve attempt violating the envelope —
        # Claude answered Lightroom-scale values (-100 highlights), absolute
        # hues (210° for a ±30 relative-shift param), and 0–1 fractions for
        # slider-unit saturations — because the schema only said
        # {"type": "number"}. The system prompt always claimed the envelope
        # was "hinted in the schema"; this makes that true.
        def _value_schema(k: str) -> dict:
            env = self.param_envelope[k]
            return {
                "type": "number",
                "minimum": env.min,
                "maximum": env.max,
                "description": (
                    f"Slider on this tool's OWN relative scale, valid range "
                    f"[{env.min}, {env.max}], step {env.step}. Not an absolute "
                    f"colour value, not a 0-1 fraction."
                ),
            }

        response_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["values"],
            "properties": {
                "values": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": required_keys,
                    "properties": {k: _value_schema(k) for k in required_keys},
                },
                "reasoning": {"type": "string"},
            },
        }
        context_summary = self._build_context_summary(ctx)
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json", by_alias=True),
            "param_ranges": {
                k: {"min": env.min, "max": env.max, "step": env.step}
                for k, env in self.param_envelope.items()
            },
            "context_summary": context_summary,
            "prior_widget_values": (
                {b.param_key: b.value for b in prior_widget.bindings}
                if prior_widget is not None else None
            ),
            "instruction": instruction,
        }
        try:
            raw = anthropic.resolve_fused_tool(
                template_id=self.id,
                prompt_payload=prompt_payload,
                response_schema=response_schema,
                session_id=getattr(ctx, "model_version", None),
            )
        except Exception as exc:
            raise ResolverError(str(exc)) from exc
        return ResolvedNumbers.model_validate(raw)

    def _build_context_summary(self, ctx: EnrichedImageContext) -> dict[str, Any]:
        """Assemble the `context_summary` dict from `self.context_inputs`.

        Flat keys: `getattr(ctx, key, None)` → serialise.
        Dotted keys `container.field`: group by container, look up
        `ctx.<container>` as a list, emit one dict per entry containing
        `label` (if present) plus each requested field."""
        flat: list[str] = []
        dotted: dict[str, list[str]] = {}  # container → [field, ...]
        for entry in self.context_inputs:
            if "." in entry:
                container, _, field = entry.partition(".")
                dotted.setdefault(container, []).append(field)
            else:
                flat.append(entry)

        summary: dict[str, Any] = {}
        for k in flat:
            summary[k] = _serialize_for_payload(getattr(ctx, k, None))
        for container, fields in dotted.items():
            entries = getattr(ctx, container, None) or []
            sliced = []
            for entry in entries:
                row: dict[str, Any] = {}
                label = getattr(entry, "label", None)
                if label is not None:
                    row["label"] = label
                for f in fields:
                    row[f] = _serialize_for_payload(getattr(entry, f, None))
                sliced.append(row)
            summary[container] = sliced
        return summary


def _scope_is_skin_likely(scope: Scope, ctx: EnrichedImageContext | None) -> bool:
    if ctx is None:
        return False
    root = scope.root
    if root.kind == "named_region":
        for rs in ctx.region_stats:
            if rs.label == root.label and rs.is_skin_likely:
                return True
    return False


def _clamp(value: float, envelope: ParamRange, skin_safe: bool) -> float:
    upper = envelope.max
    if skin_safe and envelope.skin_safe_max is not None:
        upper = min(upper, envelope.skin_safe_max)
    return max(envelope.min, min(upper, value))


def _envelope_midpoint(template: FusedToolTemplate, key: str) -> float:
    env = template.param_envelope.get(key)
    if env is None:
        return 0.0
    return (env.min + env.max) / 2.0


def _seed_numbers(template: FusedToolTemplate) -> ResolvedNumbers:
    return ResolvedNumbers(values={
        key: _envelope_midpoint(template, key)
        for key in template.param_envelope
    })


def _journal_fused_health(session_id: str | None, payload: dict) -> None:
    """Journal a fused-resolution health event (spec: fused resolution
    telemetry §1). No session_id (direct callers, tests) → skip. Telemetry
    must never break resolution, so failures only warn."""
    if not session_id:
        return
    try:
        from app.services.event_journal import write_event
        write_event(session_id, "proposal.health", {"stage": "fused_resolve", **payload})
    except Exception:  # noqa: BLE001
        logger.warning("proposal.health journal write failed", exc_info=True)


def _build_widget(
    template: FusedToolTemplate,
    intent: str,
    scope: Scope,
    numbers: ResolvedNumbers,
    origin: WidgetOrigin,
    param_source: str | None = None,
) -> Widget:
    node_id_by_target: dict[str, str] = {}
    nodes: list[WidgetNode] = []
    wid = f"w_{uuid.uuid4().hex[:8]}"
    for skeleton in template.node_skeleton:
        nid = f"n_{uuid.uuid4().hex[:6]}"
        params = dict(skeleton.fixed_params)
        for k in skeleton.tunable_param_keys:
            if k in numbers.values:
                params[k] = numbers.values[k]
        nodes.append(WidgetNode(
            id=nid, type=skeleton.node_type, params=params,
            scope=scope, inputs=[], widget_id=wid,
        ))
        node_id_by_target[skeleton.node_type] = nid

    bindings: list[ControlBinding] = []
    for skeleton in template.bindings_skeleton:
        target_node_id = skeleton.target.node_id
        if target_node_id.startswith("n_"):
            type_hint = target_node_id[2:]
            if type_hint in node_id_by_target:
                target_node_id = node_id_by_target[type_hint]
        value = numbers.values.get(skeleton.param_key, _envelope_midpoint(template, skeleton.param_key))
        default = value if skeleton.tunable_default else _envelope_midpoint(template, skeleton.param_key)
        bindings.append(ControlBinding(
            param_key=skeleton.param_key,
            label=skeleton.label,
            control_type=skeleton.control_type,
            target=NodeParamTarget(node_id=target_node_id, param_key=skeleton.target.param_key),
            control_schema=skeleton.control_schema,
            value=value,
            default=default,
        ))

    return Widget(
        id=wid,
        intent=intent,
        reasoning=numbers.reasoning,
        scope=scope,
        origin=origin,
        op_id=template.id,
        composed=False,
        nodes=nodes,
        bindings=bindings,
        preview=WidgetPreview(**template.preview),
        rejected_attempts=[],
        status="active",
        revision=1,
        param_source=param_source,
    )


async def run_fused_tool(
    template: FusedToolTemplate,
    *,
    intent: str,
    scope: Scope,
    ctx: EnrichedImageContext | None,
    prior: Widget | None,
    instruction: str | None,
    anthropic: Any,
    origin: WidgetOrigin | None = None,
    session_id: str | None = None,
) -> Widget:
    """Resolve a fused tool. Try up to 3 times. On envelope violation, clamp on
    the last retry and accept — a resolution with one out-of-range param is
    still an image-informed answer, far better than discarding it. Only when
    every attempt raised ResolverError do we seed envelope midpoints.

    Every degradation is journaled (proposal.health, stage=fused_resolve) and
    the widget records how its values were produced via `param_source`
    ("llm" | "llm_clamped" | "midpoint") so the study can tell an AI decision
    from a mechanical fallback."""
    skin_safe = _scope_is_skin_likely(scope, ctx)
    final_origin = origin or WidgetOrigin(kind="mcp_user_prompt", prompt=intent)
    attempts = 3
    for attempt in range(attempts):
        try:
            numbers = await template.resolve(intent, scope, ctx, prior, instruction, anthropic)
        except ResolverError as exc:
            logger.warning("fused_tool %s resolver error (attempt %d): %s", template.id, attempt, exc)
            _journal_fused_health(session_id, {
                "event": "resolver_retry", "tool": template.id,
                "attempt": attempt, "detail": str(exc)[:500],
            })
            continue

        clamped_values: dict[str, ParamValue] = {}
        violated_keys: list[str] = []
        for k, v in numbers.values.items():
            env = template.param_envelope.get(k)
            if env is None:
                clamped_values[k] = v
                continue
            if not isinstance(v, (int, float)):
                clamped_values[k] = v
                continue
            clamped = _clamp(float(v), env, skin_safe)
            if abs(clamped - float(v)) > 1e-6:
                violated_keys.append(k)
            clamped_values[k] = clamped
        if not violated_keys:
            return _build_widget(
                template, intent, scope, numbers, final_origin, param_source="llm",
            )
        if attempt == attempts - 1:
            # Last attempt: clamp and accept instead of discarding the whole
            # resolution for one out-of-range param.
            logger.warning(
                "fused_tool %s envelope violation on final attempt; clamping %s",
                template.id, violated_keys,
            )
            _journal_fused_health(session_id, {
                "event": "envelope_clamped", "tool": template.id,
                "params": violated_keys,
            })
            clamped_numbers = ResolvedNumbers(
                values=clamped_values, reasoning=numbers.reasoning,
            )
            return _build_widget(
                template, intent, scope, clamped_numbers, final_origin,
                param_source="llm_clamped",
            )
        logger.warning("fused_tool %s envelope violation (attempt %d); retrying", template.id, attempt)
        _journal_fused_health(session_id, {
            "event": "resolver_retry", "tool": template.id,
            "attempt": attempt, "detail": f"envelope_violation: {violated_keys}",
        })
    logger.error("fused_tool %s triple-missed; seeding from envelope midpoints", template.id)
    _journal_fused_health(session_id, {
        "event": "midpoint_seeded", "tool": template.id,
    })
    seeded = _seed_numbers(template)
    seeded.reasoning = (
        "Automatic fallback — the resolver failed; values are safe midpoints, "
        "adjust to taste."
    )
    return _build_widget(
        template, intent, scope, seeded, final_origin, param_source="midpoint",
    )
