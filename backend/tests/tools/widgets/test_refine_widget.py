import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.refine_widget import RefineWidgetTool


class _FakeAnthropic:
    def flesh_out_binding(self, request, widget, response_schema=None, session_id=None):
        return {
            "binding": {
                "param_key": "skin_protect",
                "label": "Skin protect",
                "control_type": "toggle",
                "target": {"node_id": "n_extra", "param_key": "skin_protect"},
                "control_schema": {"control_type": "toggle", "on_label": "Protect", "off_label": "Off"},
                "value": True,
                "default": True,
            },
            "additional_nodes": [
                {"type": "basic", "params": {"skin_protect": True}, "scope": {"kind": "global"}},
            ],
        }

    def resolve_widget_params(self, *, op, intent, rationale, starting_params, image_context, session_id=None, rejected_attempts=None):
        # Re-tune: push each scalar param to the top of its range so a test can
        # assert the values actually changed from the starting priors.
        out = {}
        for k, p in op.params.items():
            out[k] = p.range[1] if getattr(p, "range", None) else p.default
        return out


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "refine_widget" not in reg._tools:
        reg.register(RefineWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup(client) -> tuple[str, str]:
    """Spawn a warm_grade preset widget (kelvin + light + color) via propose_stack.
    Context is required by refine_widget (requires_context=True permission)."""
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    from app.tools.widgets.propose_stack import ProposeStackTool
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))
    reg = deps.get_tool_registry()
    if "propose_stack" not in reg._tools:
        reg.register(ProposeStackTool())
    proposed = client.post(
        "/api/tools/propose_stack",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"},
            "preset_id": "warm_grade", "origin": "mcp_user_prompt",
        }},
    ).json()
    # Use the first widget (kelvin) as the target for refine tests
    return sid, proposed["output"]["widgets"][0]["id"]


def test_refine_removes_a_binding(client) -> None:
    """Remove the kelvin binding from a warm_grade kelvin widget."""
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    first_key = w.bindings[0].param_key if w.bindings else "kelvin"
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [{"param_key": first_key, "action": "remove"}],
            "additions": [],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["paramKey"] for b in body["output"]["widget"]["bindings"]]
    assert first_key not in keys
    assert body["output"]["widget"]["composed"] is True


def test_refine_adds_a_binding(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [],
            "additions": [{"request": "add a skin-protect toggle"}],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["paramKey"] for b in body["output"]["widget"]["bindings"]]
    assert "skin_protect" in keys


def test_refine_updates_fused_target_anchor(client) -> None:
    """Single-op fused widget with compound: instruction-only refine rewrites
    anchor-1 for unlocked params.  The fake resolver pushes all scalars to
    range max (100), so after refine exposure's anchor-1 value must be 100."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget
    from app.tools.widgets.fused_compound import synthesize_compound

    sid, _ = _setup(client)
    doc = deps.get_session_store().get_document(sid)

    # Build a light-op widget with compound anchors (baseline 0, target -80).
    # Set widget-level op_id so the refine handler reaches the registry-op branch.
    w = _fused_candidate_widget()
    w.op_id = "light"
    w.compound = synthesize_compound(w, doc)
    assert w.compound is not None
    assert w.compound.anchors[1].values["n_a:exposure"] == -80.0

    doc.add_widget(w)

    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "edits": [],
            "additions": [],
            "instruction": "even darker",
        }},
    ).json()
    assert body["ok"] is True, body

    # Fake resolver returns range max (100) for all scalars — anchor-1 must
    # now reflect that instead of the original -80.
    w_out = doc.widgets[w.id]
    assert w_out.compound is not None
    assert w_out.compound.anchors[1].values["n_a:exposure"] == 100.0


def test_refine_preserves_layer_id_on_appended_nodes(client) -> None:
    """Composition refine appends LLM-fleshed nodes. Those nodes don't carry
    layer anchoring info, so without explicit stamping they end up with the
    WidgetNode default ("legacy") and the frontend's tether snaps the widget
    away from its current image. Regression guard."""
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    prior_layer_id = w.nodes[0].layer_id
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [],
            "additions": [{"request": "add a skin-protect toggle"}],
        }},
    ).json()
    assert body["ok"] is True
    out_nodes = body["output"]["widget"]["nodes"]
    # Every node — original + newly fleshed — must share the same anchor.
    for n in out_nodes:
        assert n["layerId"] == prior_layer_id, (
            f"node {n['id']!r} has layer_id={n['layerId']!r}, expected {prior_layer_id!r}"
        )


def test_refine_skips_locked_params(client) -> None:
    """Locked params (set by the user via set_widget_param) must survive refine.
    The fake resolver returns range-max for all params; if a param is locked its
    value must NOT change after refine."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget

    sid, _ = _setup(client)
    doc = deps.get_session_store().get_document(sid)

    w = _fused_candidate_widget()
    w.op_id = "light"
    doc.add_widget(w)

    # Lock the "exposure" param (simulating a user hand-set via set_widget_param)
    original_exposure = w.nodes[0].params.get("exposure", 0.0)
    w.locked_params = ["exposure"]
    doc.update_widget(w)

    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "edits": [],
            "additions": [],
            "instruction": "even brighter",
        }},
    ).json()
    assert body["ok"] is True, body

    # "exposure" is locked — must remain unchanged despite fake returning range-max
    w_out = doc.widgets[w.id]
    assert w_out.nodes[0].params.get("exposure") == original_exposure, (
        f"locked param 'exposure' must survive refine, "
        f"got {w_out.nodes[0].params.get('exposure')!r}"
    )


def test_refine_writes_to_all_layers(client) -> None:
    """When a widget node has layer_ids, refine fans the write out to every
    target layer — mirroring the set_widget_param multi-layer write."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget

    sid, _ = _setup(client)
    doc = deps.get_session_store().get_document(sid)

    w = _fused_candidate_widget()
    w.op_id = "light"
    # Give the node a layer_ids list spanning two layers
    w.nodes[0].layer_ids = ["layer_a", "layer_b"]
    w.nodes[0].layer_id = "layer_a"
    doc.add_widget(w)

    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "edits": [],
            "additions": [],
            "instruction": "darker",
        }},
    ).json()
    assert body["ok"] is True, body

    # Both layers must have the resolved exposure value in canonical state
    w_out = doc.widgets[w.id]
    new_exposure = w_out.nodes[0].params.get("exposure")
    for layer_id in ["layer_a", "layer_b"]:
        canon_exposure = doc.canonical.get(layer_id, {}).get("basic", {}).get("exposure")
        assert canon_exposure == new_exposure, (
            f"layer {layer_id!r} exposure in canonical state expected {new_exposure}, "
            f"got {canon_exposure!r}"
        )


def test_refine_fallback_to_nodes0_op_id(client) -> None:
    """When w.op_id isn't a registry op (persisted template id like 'golden_hour'),
    the refine handler must fall back to nodes[0].op_id to resolve the real op
    and still perform instruction-based re-tuning (§5.5 + §6 edge case)."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget

    sid, _ = _setup(client)
    doc = deps.get_session_store().get_document(sid)

    # Widget whose widget-level op_id is a stale template name (not in registry).
    # nodes[0].op_id = "light" (a real registry op), so the fallback should
    # resolve the "light" op and re-tune its params.
    w = _fused_candidate_widget()
    w.op_id = "golden_hour"          # template name — not in registry.ops
    # nodes[0].op_id is already "light" from _fused_candidate_widget
    assert w.nodes[0].op_id == "light"
    doc.add_widget(w)

    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "edits": [],
            "additions": [],
            "instruction": "make it even brighter",
        }},
    ).json()
    assert body["ok"] is True, body

    # Fake resolver pushes scalar params to range max (100). Since the fallback
    # resolved the "light" op via nodes[0].op_id, exposure must now be 100.
    w_out = doc.widgets[w.id]
    assert w_out.nodes[0].params.get("exposure") == 100.0, (
        f"expected exposure=100.0 via nodes[0].op_id fallback, got {w_out.nodes[0].params}"
    )
    assert w_out.revision == 2  # bumped once by refine
