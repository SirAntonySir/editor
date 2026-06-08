from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext
from app.tools.widgets.propose_widget import ProposeWidgetTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "propose_widget" not in reg._tools:
        reg.register(ProposeWidgetTool())
    return TestClient(app)


def _session(client) -> str:
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z")
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def _propose(client, sid, op_id):
    return client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": op_id, "scope": {"kind": "global"}, "op_id": op_id,
        "layer_id": "layer_a", "origin": "tool_invoked"}})


def test_open_on_canvas_creates_all_bands_hsl_widget():
    client = _client()
    sid = _session(client)
    r = _propose(client, sid, "hsl")
    assert r.status_code == 200, r.text
    doc = deps.get_session_store().get_document(sid)
    assert "hsl" in doc.canonical.get("layer_a", {})
    assert "blue_sat" in doc.canonical["layer_a"]["hsl"]
    hsl_widgets = [w for w in doc.widgets.values() if w.op_id == "hsl"]
    assert hsl_widgets, "no HSL widget created"
    assert len(hsl_widgets[0].bindings) == 24


def test_colour_band_creates_single_band_hsl_widget():
    client = _client()
    sid = _session(client)
    r = _propose(client, sid, "hsl_blue")
    assert r.status_code == 200, r.text
    doc = deps.get_session_store().get_document(sid)
    band_widgets = [w for w in doc.widgets.values() if w.op_id == "hsl_blue"]
    assert band_widgets, "no single-band HSL widget created"
    assert {b.param_key for b in band_widgets[0].bindings} == {"blue_hue", "blue_sat", "blue_lum"}
