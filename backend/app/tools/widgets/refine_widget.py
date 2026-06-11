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
from app.state.document import SessionDocument
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

        if composition_changed:
            w.composed = True
            w.bindings = kept_bindings + new_bindings
            w.nodes = w.nodes + new_nodes
            w.revision += 1
            doc.update_widget(w)
            return _Output(widget=w.model_dump(mode="json", by_alias=True))

        # No composition change → re-tune numbers via the fused template.
        if w.op_id is None:
            return _Output(widget=w.model_dump(mode="json", by_alias=True))
        templates = {t.id: t for t in all_fused_templates()}
        template = templates[w.op_id]
        new_widget = await run_fused_tool(
            template, intent=w.intent, scope=w.scope,
            ctx=doc.image_context, prior=w, instruction=input.instruction,
            anthropic=anthropic, origin=w.origin,
        )
        new_widget.id = w.id
        new_widget.revision = w.revision + 1
        doc.update_widget(new_widget)
        return _Output(widget=new_widget.model_dump(mode="json", by_alias=True))
