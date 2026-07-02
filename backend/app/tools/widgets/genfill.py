"""Generative-fill tools — Replicate bria/genfill.

genfill_create: mint a genfill widget (compose when the prompt is empty,
generating otherwise) and return immediately; the Replicate call runs as an
asyncio background task so the session write lock is never held across the
network round-trip (5–60 s). genfill_regenerate: re-run generation on an
existing genfill widget with an updated prompt/negative_prompt/seed.

Spec: docs/superpowers/specs/2026-07-02-genfill-widget-design.md
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import secrets
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.schemas.widget import (
    GenfillError, GenfillResultInfo, GenfillState, Scope, Widget,
    WidgetOrigin, WidgetPreview,
)
from app.services import disk_session_io
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions

try:
    from PIL import Image as _PILImage
    _PIL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PIL_AVAILABLE = False

logger = logging.getLogger(__name__)


class _UnknownWidget(KeyError):
    pass


class _UnknownMask(KeyError):
    pass


class _InvalidInput(Exception):
    pass


def _random_seed() -> int:
    return secrets.randbelow(2**31 - 1) + 1


def _png_dims(data: bytes) -> tuple[int, int]:
    img = _PILImage.open(io.BytesIO(data))
    return img.size


def _binary_mask_png(mask_png: bytes) -> bytes:
    """Convert a stored mask PNG (alpha-carried or grayscale) into the strict
    binary black/white L-mode PNG that Bria expects (white=255 → generate)."""
    img = _PILImage.open(io.BytesIO(mask_png))
    channel = img.getchannel("A") if "A" in img.getbands() else img.convert("L")
    binary = channel.point(lambda v: 255 if v >= 128 else 0)
    out = io.BytesIO()
    binary.save(out, format="PNG")
    return out.getvalue()


def _assert_aspect_match(doc: SessionDocument, image_node_id: str, mask) -> None:
    iw, ih = _png_dims(doc.get_image_bytes(image_node_id))
    if ih == 0 or mask.height == 0:
        raise _InvalidInput("genfill: degenerate image or mask dimensions")
    if abs((iw / ih) - (mask.width / mask.height)) > 0.02:
        raise _InvalidInput(
            f"genfill: mask aspect ratio {mask.width}x{mask.height} does not "
            f"match image {iw}x{ih}"
        )


def _publish_pending(doc: SessionDocument, bus, session_id: str) -> None:
    """Mirror BackendToolRegistry._flush_history_to_bus for the background
    task path: publish exactly the not-yet-published events and advance the
    cursor so the next registry flush doesn't re-publish them."""
    for ev in doc.history[doc._published_idx:]:
        bus.publish(session_id, ev)
    doc._published_idx = len(doc.history)


async def _run_generation(store, bus, replicate, session_id: str, widget_id: str) -> None:
    """Background half of genfill: read inputs under the lock, call Replicate
    WITHOUT the lock, write results under the lock."""
    async with store.with_document_lock(session_id) as doc:
        w = doc.widgets.get(widget_id)
        if w is None or w.genfill is None:
            return
        g = w.genfill
        image_bytes = doc.get_image_bytes(g.image_node_id)
        image_mime = doc.get_mime_type(g.image_node_id)
        mask = doc.masks.get(g.mask_id)
        if mask is None:
            return
        mask_png = _binary_mask_png(base64.b64decode(mask.png_b64))
        prompt, negative, seed = g.prompt, g.negative_prompt, g.seed

    result = await replicate.run_bria_genfill(
        image_bytes=image_bytes, image_mime=image_mime, mask_png=mask_png,
        prompt=prompt, negative_prompt=negative, seed=seed,
    )

    async with store.with_document_lock(session_id) as doc:
        w = doc.widgets.get(widget_id)
        if w is None or w.genfill is None:
            return  # dismissed while generating — drop the result
        if result.ok and result.image_bytes:
            asset_id = f"genfill-{widget_id}"
            disk_session_io.write_asset(session_id, asset_id, result.image_bytes)
            width, height = _png_dims(result.image_bytes)
            w.genfill = w.genfill.model_copy(update={
                "status": "ready",
                "result": GenfillResultInfo(asset_id=asset_id, width=width, height=height),
                "error": None,
                "seed": result.seed,
            })
        else:
            w.genfill = w.genfill.model_copy(update={
                "status": "error",
                "error": GenfillError(
                    kind=result.error_kind or "api_error",
                    message=result.error_message or "generation failed",
                ),
            })
        doc.update_widget(w)
        _publish_pending(doc, bus, session_id)
        store.checkpointer.mark_dirty(doc)


def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("genfill background task failed", exc_info=exc)


class _GenfillToolBase:
    """Shared constructor + scheduler for the two genfill tools. Instances are
    constructed WITH deps (store/bus/replicate) in register_all_widget_tools —
    unlike other widget tools they schedule work outside the handler."""

    def __init__(self, *, store, bus, replicate) -> None:
        self._store = store
        self._bus = bus
        self._replicate = replicate

    def _schedule(self, session_id: str, widget_id: str) -> None:
        task = asyncio.create_task(
            _run_generation(self._store, self._bus, self._replicate, session_id, widget_id),
            name=f"genfill:{widget_id}",
        )
        task.add_done_callback(_log_task_exception)


class _CreateInput(BaseModel):
    model_config = camel_config(extra="forbid")
    image_node_id: str = Field(min_length=1)
    mask_id: str = Field(min_length=1)
    prompt: str = ""
    negative_prompt: str | None = None
    seed: int | None = None
    origin: Literal["tool_invoked", "mcp_user_prompt"] = "tool_invoked"


class _CreateOutput(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str


class GenfillCreateTool(_GenfillToolBase, BackendTool[_CreateInput, _CreateOutput]):
    name = "genfill_create"
    kind = "mutate"
    description = (
        "Create a generative-fill widget targeting a mask. Empty prompt = "
        "compose state (no generation); non-empty prompt starts generation "
        "in the background (status flows via SSE widget.updated)."
    )
    input_schema = _CreateInput
    output_schema = _CreateOutput
    permissions = ToolPermissions(requires_image=True, requires_context=False)
    is_user_action = True

    def history_label(self, input: _CreateInput, output: _CreateOutput) -> str:  # noqa: A002
        return "Generative fill"

    async def handler(self, doc: SessionDocument, input: _CreateInput) -> _CreateOutput:  # noqa: A002
        mask = doc.masks.get(input.mask_id)
        if mask is None:
            raise _UnknownMask(input.mask_id)
        _assert_aspect_match(doc, input.image_node_id, mask)

        prompt = input.prompt.strip()
        widget_id = f"w_gf_{uuid.uuid4().hex[:8]}"
        widget = Widget(
            id=widget_id,
            intent=prompt or "Generative fill",
            scope=Scope.model_validate({"kind": "mask", "maskId": input.mask_id}),
            origin=WidgetOrigin(kind=input.origin, prompt=prompt or None,
                                anchor=f"mask:{input.mask_id}"),
            preview=WidgetPreview(kind="none", auto_before_after=False),
            genfill=GenfillState(
                status="generating" if prompt else "compose",
                prompt=prompt,
                negative_prompt=input.negative_prompt,
                seed=input.seed if input.seed is not None else _random_seed(),
                mask_id=input.mask_id,
                image_node_id=input.image_node_id,
            ),
        )
        doc.add_widget(widget)
        if prompt:
            self._schedule(doc.session_id, widget_id)
        return _CreateOutput(widget_id=widget_id)


class _RegenInput(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str = Field(min_length=1)
    prompt: str | None = None
    negative_prompt: str | None = None
    seed: int | None = None


class GenfillRegenerateTool(_GenfillToolBase, BackendTool[_RegenInput, _CreateOutput]):
    name = "genfill_regenerate"
    kind = "mutate"
    description = (
        "(Re-)run generation on an existing genfill widget. Omitted prompt "
        "keeps the stored one (must be non-empty); omitted seed rolls a new one."
    )
    input_schema = _RegenInput
    output_schema = _CreateOutput
    permissions = ToolPermissions(requires_image=True, requires_context=False)
    is_user_action = True

    def history_label(self, input: _RegenInput, output: _CreateOutput) -> str:  # noqa: A002
        return "Generative fill (regenerate)"

    async def handler(self, doc: SessionDocument, input: _RegenInput) -> _CreateOutput:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None or w.genfill is None:
            raise _UnknownWidget(input.widget_id)
        if w.genfill.status == "generating":
            raise _InvalidInput("genfill: generation already in progress")
        prompt = (input.prompt if input.prompt is not None else w.genfill.prompt).strip()
        if not prompt:
            raise _InvalidInput("genfill: prompt must not be empty")
        negative = (input.negative_prompt if input.negative_prompt is not None
                    else w.genfill.negative_prompt)
        seed = input.seed if input.seed is not None else _random_seed()
        w.genfill = w.genfill.model_copy(update={
            "status": "generating", "prompt": prompt,
            "negative_prompt": negative, "seed": seed, "error": None,
        })
        w.intent = prompt
        doc.update_widget(w)
        self._schedule(doc.session_id, input.widget_id)
        return _CreateOutput(widget_id=input.widget_id)
