"""ask_about_image atomic tool — palette Ask mode.

Free-form Q&A about the open photo. The frontend's Cmd+K has an Agent /
Ask toggle; Ask mode types the question, presses Enter, and the response
markdown renders inline.

Why this is a tool and not a bespoke `/api/ask` endpoint:
- Inherits the same rate limiter, permissions surface, and error envelope
  shape every other tool the FE calls already has.
- The context assembly (slim image_context, editor_state summary, active
  mask label) lives close to the consumer, mirroring smart_match_command.

Mid tier (Sonnet 4.6 via AnthropicClient._sonnet_model) so the answer is
grounded and well-formatted without paying Opus prices for what is
essentially a chat turn.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.api.deps import get_anthropic_client
from app.schemas._camel import camel_config
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions

# Hard cap on the editor-state summary so a heavily-edited session
# doesn't push the prompt over the token budget — every active widget
# contributes one short line.
_MAX_WIDGETS_IN_SUMMARY = 24


class _AttachedChip(BaseModel):
    """One chip the user dropped onto Cmd+K (Info-tab pin). Mirrors the
    frontend's `AttachedContextItem` shape."""
    model_config = camel_config(extra="forbid")
    label: str
    value: str
    source_id: str | None = None


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    query: str = Field(min_length=1, max_length=2000)
    attached_chips: list[_AttachedChip] = Field(default_factory=list)


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    markdown: str


def _summarise_editor_state(doc: SessionDocument) -> dict[str, Any]:
    """Compact view of the user's current adjustment stack for the LLM.

    One line per active widget: its intent + the param keys that diverge
    from defaults, with their values. Active mask (object selection)
    surfaces by label only — the mask bytes never go to the LLM. Capped
    at _MAX_WIDGETS_IN_SUMMARY entries with a trailing "...N more"
    marker so the prompt size stays bounded.
    """
    widgets: list[dict[str, Any]] = []
    for wid in doc.widget_order:
        w = doc.widgets.get(wid)
        if w is None or w.status != "active":
            continue
        touched = []
        for b in w.bindings:
            if b.value != b.default:
                touched.append({"param": b.param_key, "value": b.value})
        widgets.append({
            "intent": w.intent,
            "op_id": w.op_id,
            "touched": touched,
        })
        if len(widgets) >= _MAX_WIDGETS_IN_SUMMARY:
            break

    truncated = max(0, len([
        wid for wid in doc.widget_order
        if (w := doc.widgets.get(wid)) is not None and w.status == "active"
    ]) - len(widgets))

    active_mask_label = None
    if doc.active_mask_id is not None:
        m = doc.masks.get(doc.active_mask_id)
        if m is not None:
            active_mask_label = m.label
    elif doc.committed_mask_id is not None:
        m = doc.masks.get(doc.committed_mask_id)
        if m is not None:
            active_mask_label = m.label

    return {
        "active_widgets": widgets,
        "active_widgets_truncated": truncated,
        "active_mask_label": active_mask_label,
    }


class AskAboutImageTool(BackendTool[_Input, _Output]):
    name = "ask_about_image"
    kind = "query"
    description = (
        "Free-form Q&A about the open photo. Returns a short markdown "
        "answer grounded in the image, the current editor state, and any "
        "chips the user attached. Palette Ask mode."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False,
        expose_rest=True,
        requires_image=True,
        requires_context=True,
    )
    is_user_action = True

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        from app.services.llm_context import image_context_for_llm

        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        ctx_dict = image_context_for_llm(
            ctx.model_dump(mode="json", by_alias=True) if ctx is not None else None,
        )

        editor_state = _summarise_editor_state(doc)
        chips = [c.model_dump(mode="json", by_alias=True) for c in input.attached_chips]

        markdown = get_anthropic_client().ask_about_image(
            image_bytes=doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID),
            mime_type=doc.get_mime_type(DEFAULT_IMAGE_NODE_ID),
            query=input.query,
            image_context=ctx_dict,
            editor_state=editor_state,
            attached_chips=chips,
            session_id=doc.session_id,
        )
        return _Output(markdown=markdown)
