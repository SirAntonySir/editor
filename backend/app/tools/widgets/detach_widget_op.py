"""detach_widget_op — split one op out of a fused intent widget.

Moves a single WidgetNode (identified by node_id) from a fused widget into a
new standalone widget.  The caller picks by node_id rather than op_id because
a widget can carry two nodes of the same op.

The new widget has origin.kind='fused_expansion' so the frontend can render it
as a satellite.  The canonical adjustment values are NOT touched — the node
already wrote its params into the op_graph; moving its widget ownership has no
pixel effect.

``locked_params`` namespace note: ``locked_params`` is a bare-param_key
namespace shared across all nodes in a widget (schema limitation inherited from
set_widget_param / unlock_widget_param).  Under key collisions (two nodes both
expose e.g. "amount") the lock is ambiguous system-wide.  This tool handles
collisions conservatively: a locked key is only dropped when *no* surviving
binding still references that key, so surviving pins are never wrongly unlocked.

See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md §6.5.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas._camel import camel_config
from app.schemas.widget import Widget, WidgetOrigin
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


# ---------------------------------------------------------------------------
# Error classes (mirror sibling conventions)
# ---------------------------------------------------------------------------

class _UnknownWidget(KeyError):
    pass


class _WidgetDismissed(ValueError):
    """Widget is dismissed; cannot structurally modify it."""
    pass


class _NodeNotOnWidget(KeyError):
    """The requested node_id is not a member of the widget's nodes list."""
    pass


class _NotFusedWidget(ValueError):
    """detach_widget_op is only valid for fused (compound) widgets."""
    pass


# ---------------------------------------------------------------------------
# I/O schemas
# ---------------------------------------------------------------------------

class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    node_id: str


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    # The newly minted standalone widget.
    widget: dict
    # The mutated parent (fused) widget, with the node removed.
    parent: dict


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------

class DetachWidgetOpTool(BackendTool[_Input, _Output]):
    name = "detach_widget_op"
    kind = "mutate"
    description = (
        "Split one op out of a fused intent widget into a standalone widget. "
        "Identified by node_id (not op_id) so two nodes of the same op can be "
        "distinguished. REST-only — this is a pointer-device action from the "
        "widget card ⋯ menu, not an agent action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        # Pull the display_name from the new widget's dump for a friendly label.
        display = output.widget.get("displayName") or output.widget.get("opId") or "op"
        return f"Detached {display}"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # ------------------------------------------------------------------
        # 1. Guards
        # ------------------------------------------------------------------
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)

        if w.status == "dismissed":
            raise _WidgetDismissed(
                f"widget {input.widget_id!r} is dismissed — cannot detach ops from it"
            )

        if w.compound is None:
            raise _NotFusedWidget(
                f"widget {input.widget_id!r} has no compound block — "
                "detach_widget_op is only for fused intent widgets"
            )

        node = next((n for n in w.nodes if n.id == input.node_id), None)
        if node is None:
            raise _NodeNotOnWidget(
                f"node {input.node_id!r} is not a member of widget {input.widget_id!r}"
            )

        if len(w.nodes) <= 1:
            # Single-node fused widget: there is nothing to split off — so
            # "detach from intent" degrades to UN-FUSE IN PLACE. The driver
            # (compound block) is stripped and the widget becomes a plain op
            # widget; nodes, bindings, and canonical are untouched, so pixels
            # don't move. No second widget is minted; the response carries the
            # same widget as both `widget` and `parent`.
            w.compound = None
            w.driver_value = None
            w.revision += 1
            doc.update_widget(w)
            dump = w.model_dump(mode="json", by_alias=True)
            return _Output(widget=dump, parent=dump)

        # ------------------------------------------------------------------
        # 2. Build the new standalone widget
        # ------------------------------------------------------------------
        from app.registry.loader import get_registry
        from app.tools.widgets.propose_stack import _op_display

        reg = get_registry()
        op_display_name = _op_display(node.op_id or "") if node.op_id else node.type

        new_widget_id = f"w_{uuid.uuid4().hex[:8]}"

        # Bindings whose target points at this node move to the new widget.
        detached_bindings = [
            b for b in w.bindings if b.target.node_id == input.node_id
        ]
        remaining_bindings = [
            b for b in w.bindings if b.target.node_id != input.node_id
        ]

        # Update the node's widget_id in-place — it keeps its id and params.
        node.widget_id = new_widget_id

        new_widget = Widget(
            id=new_widget_id,
            intent=w.intent,
            scope=w.scope,
            origin=WidgetOrigin(
                kind="fused_expansion",
                prompt=None,
                parent_widget_id=w.id,
            ),
            op_id=node.op_id,
            composed=False,
            nodes=[node],
            bindings=detached_bindings,
            preview=w.preview,
            rejected_attempts=[],
            status="active",
            revision=1,
            display_name=op_display_name,
            category=w.category,
            # No compound on the new standalone widget.
            compound=None,
            driver_value=None,
        )

        # ------------------------------------------------------------------
        # 3. Mutate the fused widget
        # ------------------------------------------------------------------
        node_prefix = f"{input.node_id}:"

        # Remove the detached node.
        w.nodes = [n for n in w.nodes if n.id != input.node_id]

        # Remove the detached bindings.
        w.bindings = remaining_bindings

        # Drop anchor entries keyed with this node's prefix from EVERY anchor
        # (baseline / proposal / max).
        if w.compound is not None and w.compound.anchors:
            for anchor in w.compound.anchors:
                anchor.values = {
                    k: v for k, v in anchor.values.items()
                    if not k.startswith(node_prefix)
                }

        # If the compound anchors are now empty → compound has nothing to drive.
        if w.compound is not None:
            all_values_empty = all(
                not anchor.values for anchor in w.compound.anchors
            )
            if all_values_empty:
                w.compound = None
                w.driver_value = None

        # Drop locked_params entries that belonged exclusively to the detached
        # node's bindings.  If a SURVIVING binding shares the same bare
        # param_key (collision — two nodes both exposing e.g. "amount"), we
        # keep the lock so the surviving pin is not wrongly unlocked.
        detached_param_keys = {b.param_key for b in detached_bindings}
        surviving_param_keys = {b.param_key for b in w.bindings}  # post-move
        w.locked_params = [
            p for p in w.locked_params
            if p not in detached_param_keys or p in surviving_param_keys
        ]

        # Back-compat: op_id = first remaining node's op_id.
        if w.op_id == node.op_id and w.nodes:
            w.op_id = w.nodes[0].op_id

        # ------------------------------------------------------------------
        # 4. Persist + return
        # ------------------------------------------------------------------
        doc.add_widget(new_widget)
        w.revision += 1
        doc.update_widget(w)

        return _Output(
            widget=new_widget.model_dump(mode="json", by_alias=True),
            parent=w.model_dump(mode="json", by_alias=True),
        )
