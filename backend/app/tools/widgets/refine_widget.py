from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    Scope,
    WidgetNode,
)
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool


class _UnknownWidget(KeyError):
    pass


class BindingEdit(BaseModel):
    model_config = camel_config(extra="forbid")
    param_key: str
    action: Literal["keep", "remove"]


class BindingRequest(BaseModel):
    model_config = camel_config(extra="forbid")
    request: str = Field(min_length=1)
    control_type_hint: str | None = None
    target_hint: str | None = None


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str
    edits: list[BindingEdit] = Field(default_factory=list)
    additions: list[BindingRequest] = Field(default_factory=list)
    instruction: str | None = None


class _Output(BaseModel):
    widget: dict


class RefineWidgetTool(BackendTool[_Input, _Output]):
    name = "refine_widget"
    kind = "mutate"
    description = (
        "Composition edit on a widget — keep/remove existing bindings, add new "
        "bindings from short phrases, optionally re-tune numbers with an instruction."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        return "Refined widget"

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)

        anthropic = deps.get_anthropic_client()

        to_remove = {e.param_key for e in input.edits if e.action == "remove"}
        kept_bindings = [b for b in w.bindings if b.param_key not in to_remove]

        new_bindings: list[ControlBinding] = []
        new_nodes: list[WidgetNode] = []
        for req in input.additions:
            fleshed = anthropic.flesh_out_binding(
                request=req.request,
                widget=w.model_dump(mode="json", by_alias=True),
                session_id=doc.session_id,
            )
            binding_dict = fleshed["binding"]
            new_bindings.append(ControlBinding.model_validate(binding_dict))
            for node_dict in fleshed.get("additional_nodes", []):
                nid = f"n_{uuid.uuid4().hex[:6]}"
                new_nodes.append(WidgetNode(
                    id=nid, type=node_dict["type"], params=node_dict.get("params", {}),
                    scope=Scope.model_validate(node_dict.get("scope", {"kind": "global"})),
                    inputs=[], widget_id=w.id,
                ))

        composition_changed = bool(to_remove) or bool(new_bindings)

        # Anchor info to preserve across the refine — the prior widget's
        # primary layer_id and layer_ids define which image-node the
        # frontend's workspace-tether resolves this widget to. Without
        # carrying these through, run_fused_tool returns nodes with the
        # WidgetNode "legacy" default and the widget visibly demounts
        # from its current image to the active one (or to nowhere).
        anchor_layer_id = w.nodes[0].layer_id if w.nodes else "legacy"
        anchor_layer_ids = w.nodes[0].layer_ids if w.nodes else None

        if composition_changed:
            # Stamp the prior anchor onto each freshly-fleshed node so the
            # tether stays put — the LLM-fleshed nodes don't carry
            # layer-anchor info.
            for n in new_nodes:
                n.layer_id = anchor_layer_id
                if anchor_layer_ids is not None:
                    n.layer_ids = anchor_layer_ids
            w.composed = True
            w.bindings = kept_bindings + new_bindings
            w.nodes = w.nodes + new_nodes
            w.revision += 1
            doc.update_widget(w)
            return _Output(widget=w.model_dump(mode="json", by_alias=True))

        # No composition change → re-tune numbers from the instruction.
        if w.op_id is None:
            return _Output(widget=w.model_dump(mode="json", by_alias=True))

        templates = {t.id: t for t in all_fused_templates()}
        template = templates.get(w.op_id)
        if template is not None:
            # Fused widget → re-resolve the whole template with the instruction.
            new_widget = await run_fused_tool(
                template, intent=w.intent, scope=w.scope,
                ctx=doc.get_image_context(DEFAULT_IMAGE_NODE_ID), prior=w, instruction=input.instruction,
                anthropic=anthropic, origin=w.origin, session_id=doc.session_id,
            )
            new_widget.id = w.id
            new_widget.revision = w.revision + 1
            # Preserve the prior anchoring. The fused template rebuilds the
            # widget from scratch (new nodes, new scope), which would otherwise
            # snap it back to the default layer / global scope and detach the
            # frontend tether from the current image-node.
            new_widget.scope = w.scope
            for n in new_widget.nodes:
                n.layer_id = anchor_layer_id
                if anchor_layer_ids is not None:
                    n.layer_ids = anchor_layer_ids
            doc.update_widget(new_widget)
            return _Output(widget=new_widget.model_dump(mode="json", by_alias=True))

        # Single registry-op widget (kelvin / light / color / curves / …): there
        # is no fused template to re-run, so re-tune the op's params directly
        # from the instruction via the param resolver, then write them back
        # through the widget's node + bindings + canonical so the image updates
        # live and the sliders track. (Without this branch instruction-only
        # refine of a registry-op widget KeyError'd on `templates[op_id]`.)
        from app.registry.loader import get_registry
        op = get_registry().ops.get(w.op_id)
        node = w.nodes[0] if w.nodes else None
        if op is None or node is None or not input.instruction:
            return _Output(widget=w.model_dump(mode="json", by_alias=True))

        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        resolved = anthropic.resolve_widget_params(
            op=op,
            intent=w.intent,
            rationale=input.instruction,
            starting_params=dict(node.params),
            image_context=ctx.model_dump(mode="json") if ctx is not None else {},
            session_id=doc.session_id,
        )
        for key, value in resolved.items():
            node.params[key] = value
            doc.set_param(node.layer_id, node.type, key, value)
            binding = next((b for b in w.bindings if b.param_key == key), None)
            if binding is not None:
                binding.value = value
        # Fused intent widget: refine re-aimed the proposal — rewrite the
        # target anchor (position 1.0) for unlocked params so the driver's
        # "100" now means the refined values. Baseline + driver_value stay.
        from app.tools.widgets.fused_compound import update_target_anchor
        update_target_anchor(w, resolved)
        w.revision += 1
        doc.update_widget(w)
        return _Output(widget=w.model_dump(mode="json", by_alias=True))
