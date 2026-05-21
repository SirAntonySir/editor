from __future__ import annotations

import logging
import uuid
from abc import ABC, abstractmethod
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


class FusedToolTemplate(ABC):
    id: str
    description: str
    typical_use: str
    node_skeleton: list[NodeSkeleton]
    bindings_skeleton: list[BindingSkeleton]
    preview: dict[str, Any]
    requires_scope: Literal["any", "non_global", "named_region", "skin_safe"]
    param_envelope: dict[str, ParamRange]
    safety: dict[str, Any]
    context_inputs: list[str]

    @abstractmethod
    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        ...


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


def _build_widget(
    template: FusedToolTemplate,
    intent: str,
    scope: Scope,
    numbers: ResolvedNumbers,
    origin: WidgetOrigin,
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
        fused_tool_id=template.id,
        composed=False,
        nodes=nodes,
        bindings=bindings,
        preview=WidgetPreview(**template.preview),
        rejected_attempts=[],
        status="active",
        revision=1,
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
) -> Widget:
    """Resolve a fused tool. Try up to 3 times. On envelope violation, clamp on
    last retry. On triple-miss or resolver exception, seed with envelope midpoints."""
    skin_safe = _scope_is_skin_likely(scope, ctx)
    final_origin = origin or WidgetOrigin(kind="mcp_user_prompt", prompt=intent)
    for attempt in range(3):
        try:
            numbers = await template.resolve(intent, scope, ctx, prior, instruction, anthropic)
        except ResolverError as exc:
            logger.warning("fused_tool %s resolver error (attempt %d): %s", template.id, attempt, exc)
            continue

        clamped_values: dict[str, ParamValue] = {}
        out_of_envelope = False
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
                out_of_envelope = True
            clamped_values[k] = clamped
        if not out_of_envelope:
            return _build_widget(template, intent, scope, numbers, final_origin)
        logger.warning("fused_tool %s envelope violation (attempt %d); retrying", template.id, attempt)
    logger.error("fused_tool %s triple-missed; seeding from envelope midpoints", template.id)
    return _build_widget(template, intent, scope, _seed_numbers(template), final_origin)
