from __future__ import annotations

import uuid

from app.schemas.operation_graph import Node, OperationGraph, PanelBinding, Scope as GraphScope
from app.schemas.widget import Scope as WidgetScope, Widget
from app.state.document import SessionDocument


def _widget_scope_to_graph_scope(s: WidgetScope) -> GraphScope:
    """Translate the widget-side scope discriminated union into the
    OperationGraph's looser Scope type the frontend renderer already consumes."""
    root = s.root
    if root.kind == "global":
        return GraphScope(kind="global")
    if root.kind == "named_region":
        return GraphScope(kind="mask:proposed", label=root.label)
    return GraphScope(kind="mask:click")  # mask_id is a backend-only handle


def _binding_to_panel_binding(widget: Widget) -> list[PanelBinding]:
    out: list[PanelBinding] = []
    for b in widget.bindings:
        schema_root = b.control_schema.root
        control = "slider"
        if b.control_type == "toggle":
            control = "toggle"
        elif b.control_type in {"choice", "color", "region_picker", "mask_thumbnail"}:
            control = "picker"
        # Pull min/max/step/default for slider-like schemas; leave None otherwise.
        min_v = getattr(schema_root, "min", None)
        max_v = getattr(schema_root, "max", None)
        step_v = getattr(schema_root, "step", None)
        out.append(
            PanelBinding(
                node_id=b.target.node_id,
                param_key=b.target.param_key,
                label=b.label,
                control=control,  # type: ignore[arg-type]
                min=min_v,
                max=max_v,
                default=b.default if isinstance(b.default, (int, float, str, bool)) else None,
                step=step_v,
                reasoning=b.reasoning,
            )
        )
    return out


def project_to_graph(doc: SessionDocument) -> OperationGraph:
    """Pure projection of active widgets → OperationGraph.

    Iterates doc.widget_order so the active-widget set keeps a deterministic
    render order. Dismissed widgets are excluded. No mutation."""
    nodes: list[Node] = []
    bindings: list[PanelBinding] = []
    user_goal_parts: list[str] = []
    for wid in doc.widget_order:
        w = doc.widgets.get(wid)
        if w is None or w.status != "active":
            continue
        for wn in w.nodes:
            nodes.append(
                Node(
                    id=wn.id,
                    type=wn.type,
                    scope=_widget_scope_to_graph_scope(wn.scope),
                    params=wn.params,
                    inputs=wn.inputs,
                )
            )
        bindings.extend(_binding_to_panel_binding(w))
        user_goal_parts.append(w.intent)
    return OperationGraph(
        id=f"projected-{uuid.uuid4().hex[:8]}",
        user_goal="; ".join(user_goal_parts),
        reasoning=None,
        nodes=nodes,
        panel_bindings=bindings,
        metadata={"projection": "1"},
    )
