import asyncio
import io

import pytest

from app.schemas.widget import MaskRecord
from app.services import disk_session_io as dio
from app.services.replicate_client import GenfillResult
from app.state.document import DEFAULT_IMAGE_NODE_ID
from app.tools.widgets.genfill import (
    GenfillCreateTool, GenfillRegenerateTool, _run_generation,
)


def _png(mode: str, size: tuple[int, int], color) -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new(mode, size, color).save(b, "PNG")
    return b.getvalue()


def _mask_png_b64(size=(2, 2)) -> str:
    import base64
    return base64.b64encode(_png("L", size, 255)).decode("ascii")


def _image_png_2x2() -> bytes:
    return _png("RGB", (2, 2), (10, 20, 30))


def _add_mask(doc, mask_id="m1", w=2, h=2):
    doc.add_mask(MaskRecord(
        id=mask_id, width=w, height=h, png_b64=_mask_png_b64((w, h)),
        source="sam_point", label="thing", image_node_id=DEFAULT_IMAGE_NODE_ID,
    ))


class _FakeReplicate:
    def __init__(self, result: GenfillResult):
        self.result = result
        self.calls: list[dict] = []

    async def run_bria_genfill(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class _FakeLockCtx:
    def __init__(self, doc):
        self.doc = doc

    async def __aenter__(self):
        return self.doc

    async def __aexit__(self, *a):
        return False


class _FakeStore:
    def __init__(self, doc):
        self.doc = doc
        self.dirty = []
        outer = self

        class _Ckpt:
            def mark_dirty(self, d):
                outer.dirty.append(d)

        self.checkpointer = _Ckpt()

    def with_document_lock(self, sid):
        return _FakeLockCtx(self.doc)


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, sid, ev):
        self.published.append((sid, ev))


def _make_tool(doc, result=None):
    store = _FakeStore(doc)
    bus = _FakeBus()
    rep = _FakeReplicate(result or GenfillResult(ok=True, image_bytes=_image_png_2x2(), seed=42))
    tool = GenfillCreateTool(store=store, bus=bus, replicate=rep)
    scheduled: list[tuple[str, str]] = []
    tool._schedule = lambda sid, wid: scheduled.append((sid, wid))  # no real task
    return tool, store, bus, rep, scheduled


def _doc_with_image(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    return doc


def test_create_compose_widget_empty_prompt(make_doc):
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    tool, _, _, _, scheduled = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "",
         "origin": "tool_invoked"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "compose"
    assert w.nodes == [] and w.bindings == []
    assert scheduled == []  # no generation for compose


def test_create_generating_widget_schedules_task(make_doc):
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    tool, _, _, _, scheduled = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "a boat",
         "origin": "mcp_user_prompt"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "generating"
    assert w.genfill.prompt == "a boat"
    assert w.genfill.seed > 0
    assert scheduled == [(doc.session_id, out.widget_id)]


def test_create_unknown_mask_raises(make_doc):
    doc = _doc_with_image(make_doc)
    tool, *_ = _make_tool(doc)
    with pytest.raises(KeyError):
        asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
            {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "nope", "prompt": "x",
             "origin": "tool_invoked"})))


def test_create_aspect_mismatch_raises(make_doc):
    doc = _doc_with_image(make_doc)
    _add_mask(doc, w=4, h=2)  # 2:1 mask vs 1:1 image
    tool, *_ = _make_tool(doc)
    with pytest.raises(Exception) as exc_info:
        asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
            {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
             "origin": "tool_invoked"})))
    assert exc_info.value.__class__.__name__ == "_InvalidInput"


def test_run_generation_success_writes_asset_and_updates_widget(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    tool, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "a boat",
         "origin": "tool_invoked"})))
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "ready"
    assert w.genfill.result.asset_id == f"genfill-{out.widget_id}"
    assert w.genfill.result.width == 2 and w.genfill.result.height == 2
    assert dio.read_asset(doc.session_id, f"genfill-{out.widget_id}") is not None
    # replicate got the prompt and a strict binary mask PNG
    assert rep.calls and rep.calls[0]["prompt"] == "a boat"
    assert rep.calls[0]["mask_png"][:8] == b"\x89PNG\r\n\x1a\n"
    # widget.updated published + doc marked dirty
    assert any(ev.kind == "widget.updated" for _, ev in bus.published)
    assert store.dirty


def test_run_generation_error_sets_error_state(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    fail = GenfillResult(ok=False, image_bytes=None, seed=1,
                         error_kind="moderation", error_message="blocked")
    tool, store, bus, rep, _ = _make_tool(doc, result=fail)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
         "origin": "tool_invoked"})))
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "error"
    assert w.genfill.error.kind == "moderation"


def test_run_generation_widget_dismissed_midflight_is_noop(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    tool, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
         "origin": "tool_invoked"})))
    del doc.widgets[out.widget_id]  # simulate hard-deleted widget
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    assert dio.read_asset(doc.session_id, f"genfill-{out.widget_id}") is None


def test_regenerate_requires_prompt_and_rerolls_seed(make_doc):
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    create, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(create.handler(doc, create.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "",
         "origin": "tool_invoked"})))
    regen = GenfillRegenerateTool(store=store, bus=bus, replicate=rep)
    scheduled = []
    regen._schedule = lambda sid, wid: scheduled.append((sid, wid))
    # empty effective prompt → _InvalidInput
    with pytest.raises(Exception) as exc_info:
        asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
            {"widgetId": out.widget_id})))
    assert exc_info.value.__class__.__name__ == "_InvalidInput"
    # with prompt → generating, seed set, scheduled
    asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
        {"widgetId": out.widget_id, "prompt": "a boat"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "generating" and w.genfill.prompt == "a boat"
    first_seed = w.genfill.seed
    assert scheduled == [(doc.session_id, out.widget_id)]
    # explicit seed → kept (reset status first; regenerate refuses mid-flight)
    w.genfill = w.genfill.model_copy(update={"status": "ready"})
    asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
        {"widgetId": out.widget_id, "seed": first_seed})))
    assert doc.widgets[out.widget_id].genfill.seed == first_seed


def test_regenerate_refuses_while_generating(make_doc):
    doc = _doc_with_image(make_doc)
    _add_mask(doc)
    create, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(create.handler(doc, create.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "a boat",
         "origin": "tool_invoked"})))
    regen = GenfillRegenerateTool(store=store, bus=bus, replicate=rep)
    regen._schedule = lambda sid, wid: None
    with pytest.raises(Exception) as exc_info:
        asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
            {"widgetId": out.widget_id, "prompt": "again"})))
    assert exc_info.value.__class__.__name__ == "_InvalidInput"
