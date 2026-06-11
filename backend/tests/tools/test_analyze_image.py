import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.analyze_image import AnalyzeImageTool


class _FakeClaude:
    def analyze_image(self, image_bytes, mime_type, session_id=None):
        from app.schemas.image_context import ImageContext

        return ImageContext(
            subjects=["person"],
            lighting="flat",
            dominant_tones=["midtones"],
            mood="calm",
            candidate_regions=[],
            model_name="fake",
            model_version="0",
            generated_at="2026-05-21T00:00:00Z",
        )


class _FakeClaudeFull(_FakeClaude):
    def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
        from app.services.anthropic_client import _ContextSoftFields
        from app.schemas.enriched_context import Problem
        return _ContextSoftFields(
            estimated_white_point=(255, 255, 255),
            wb_neutral_confidence=0.5,
            grade_character="neutral",
            problems=[Problem(kind="low_contrast", severity=0.6, suggested_fused_tools=["exposure_balance"])],
            region_soft_fields=[],
        )

    def suggest_fused_tools_for_character(self, *, grade_character, lighting, dominant_tones, subjects, exclude, n, session_id=None):
        return []


@pytest.fixture
def client():
    from app.main import app

    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeClaudeFull()
    reg = deps.get_tool_registry()
    if "analyze_image" not in reg._tools:
        reg.register(AnalyzeImageTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def test_analyze_image_runs_and_caches(client) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["mood"] == "calm"
    body2 = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body2["output"]["mood"] == "calm"


def test_analyze_image_syncs_record_context(client) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    record = deps.get_session_store().get(sid)
    assert record.context is not None
    assert record.context["mood"] == "calm"


def test_analyze_image_fills_cheap_pass_and_soft_fields(client) -> None:
    from app.schemas.enriched_context import EnrichedImageContext
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ctx = body["output"]
    assert ctx["gradeCharacter"] == "neutral"
    assert ctx["clippedShadowsPct"] == 0.0
    assert any(p["kind"] == "low_contrast" for p in ctx["problems"])
    doc = deps.get_session_store().get_document(sid)
    assert isinstance(doc.image_context, EnrichedImageContext)


def test_analyze_image_skips_sam_by_default(client, monkeypatch) -> None:
    """SAM segmentation is gated OFF by default: analyze must NOT call the SAM
    service (no embed), yet still produce the Claude image context. Keeping SAM
    out of the concurrent gather is what lets the ai_context phase finish."""
    from io import BytesIO
    from unittest.mock import MagicMock
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext

    monkeypatch.delenv("ANALYZE_SAM", raising=False)
    fake_sam = MagicMock()
    monkeypatch.setattr(deps, "get_sam_client", lambda: fake_sam)

    buf = BytesIO(); Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}}).json()

    assert body["ok"] is True
    fake_sam.embed.assert_not_called()  # SAM service must stay idle when disabled
    doc = deps.get_session_store().get_document(sid)
    assert isinstance(doc.image_context, EnrichedImageContext)  # context still produced


def test_autonomous_suggestions_minted_from_problems(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}

    class _FakeFull(_FakeClaudeFull):
        def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
            from app.services.anthropic_client import _ContextSoftFields
            from app.schemas.enriched_context import Problem
            return _ContextSoftFields(
                estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.5,
                grade_character="neutral",
                problems=[Problem(
                    kind="clipped_highlights", severity=0.8, region_label=None,
                    bbox=None, suggested_fused_tools=["exposure_balance"],
                )],
                region_soft_fields=[],
            )
        def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
            return {"values": {
                "shadows": 20, "highlights": -30, "whites": 0, "blacks": 0,
            }, "reasoning": ""}
        def name_pick_fused_tool(self, intent, candidates, session_id=None):
            return "exposure_balance"

    deps._anthropic_client = _FakeFull()
    sid = client.post("/api/session", files=files).json()["session_id"]
    client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    )
    doc = deps.get_session_store().get_document(sid)
    auto = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(auto) >= 1
    assert auto[0].op_id == "exposure_balance"


def test_autonomous_suggestion_nodes_carry_supplied_layer_id(client) -> None:
    """analyze_image stamps the frontend's real layer_id onto every autonomous
    widget node, instead of the "legacy" default — otherwise the frontend
    renderer (which filters op_graph nodes by exact layer_id match) drops them."""
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}

    class _FakeFull(_FakeClaudeFull):
        def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
            from app.services.anthropic_client import _ContextSoftFields
            from app.schemas.enriched_context import Problem
            return _ContextSoftFields(
                estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.5,
                grade_character="neutral",
                problems=[Problem(
                    kind="clipped_highlights", severity=0.8, region_label=None,
                    bbox=None, suggested_fused_tools=["exposure_balance"],
                )],
                region_soft_fields=[],
            )
        def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
            return {"values": {"shadows": 20, "highlights": -30, "whites": 0, "blacks": 0}, "reasoning": ""}
        def name_pick_fused_tool(self, intent, candidates, session_id=None):
            return "exposure_balance"

    deps._anthropic_client = _FakeFull()
    sid = client.post("/api/session", files=files).json()["session_id"]
    client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {"layer_id": "layer_real"}},
    )
    doc = deps.get_session_store().get_document(sid)
    auto = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(auto) >= 1
    node_layer_ids = {n.layer_id for w in auto for n in w.nodes}
    assert node_layer_ids == {"layer_real"}, (
        f"autonomous widget nodes must carry the supplied layer_id, got {node_layer_ids}"
    )


import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.main import app
from app.schemas.enriched_context import EnrichedImageContext, Problem
from app.services.anthropic_client import _ContextSoftFields


def _fake_claude_for_topup(
    *,
    problems: list[Problem],
    topup_picks: list[str],
    resolve_values: dict,
):
    """Builds a MagicMock that walks a session through analyze_image + the
    fused-tool minting for each problem and (if needed) the top-up."""
    from unittest.mock import MagicMock
    from app.schemas.image_context import ImageContext
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext(
        subjects=["scene"], lighting="flat", dominant_tones=["midtones"],
        mood="calm", candidate_regions=[],
        model_name="fake", model_version="0", generated_at="2026-05-23T00:00:00Z",
    )
    fake.augment_context_soft_fields.return_value = _ContextSoftFields(
        estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.7,
        grade_character="neutral", problems=problems, region_soft_fields=[],
    )
    fake.resolve_fused_tool.return_value = {"values": resolve_values, "reasoning": ""}
    fake.suggest_fused_tools_for_character.return_value = topup_picks
    return fake


def _bootstrap_session() -> str:
    from io import BytesIO
    from PIL import Image
    client = TestClient(app)
    buf = BytesIO(); Image.new("RGB", (64, 64), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_analyze_mints_target_when_no_problems(monkeypatch) -> None:
    """Zero problems → top-up fills to TARGET (3). The picks below have
    DISJOINT canonical targets so the knob-collision dedup doesn't fire:
      - tone_red   → hsl.red_*
      - lift_shadows → basic.shadows + basic.blacks
      - micro_contrast → clarity.amount
    """
    fake = _fake_claude_for_topup(
        problems=[],
        topup_picks=["tone_red", "lift_shadows", "micro_contrast"],
        resolve_values={
            "red_hue": 0, "red_sat": 0, "red_lum": 0,
            "shadows": 10, "blacks": 5,
            "amount": 20,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    r = client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 3
    fused_ids = {w.op_id for w in autonomous}
    assert fused_ids == {"tone_red", "lift_shadows", "micro_contrast"}


def test_analyze_tops_up_when_one_problem(monkeypatch) -> None:
    """One high-severity problem → 1 minted from problem + 2 from top-up = TARGET (3).
    Picks chosen to have non-overlapping canonical targets:
      - cast_correct (problem)  → kelvin.temperature + basic.saturation
      - lift_shadows  (top-up)  → basic.shadows + basic.blacks
      - micro_contrast (top-up) → clarity.amount
    """
    fake = _fake_claude_for_topup(
        problems=[Problem(
            kind="strong_color_cast", severity=0.8, region_label=None,
            suggested_fused_tools=["cast_correct"],
        )],
        topup_picks=["lift_shadows", "micro_contrast"],
        resolve_values={
            "corrective_kelvin": 0, "sat_correction": 0,
            "shadows": 5, "blacks": 5,
            "amount": 20,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 3
    assert {w.op_id for w in autonomous} == {"cast_correct", "lift_shadows", "micro_contrast"}
    args, kwargs = fake.suggest_fused_tools_for_character.call_args
    assert "cast_correct" in kwargs["exclude"]


def test_analyze_no_topup_when_target_already_met(monkeypatch) -> None:
    """3 high-severity problems with non-overlapping canonical targets →
    TARGET met → top-up not called."""
    fake = _fake_claude_for_topup(
        problems=[
            # cast_correct → kelvin.temperature + basic.saturation
            Problem(kind="strong_color_cast", severity=0.8, region_label=None,
                    suggested_fused_tools=["cast_correct"]),
            # lift_shadows → basic.shadows + basic.blacks (disjoint with cast_correct)
            Problem(kind="crushed_shadows", severity=0.8, region_label=None,
                    suggested_fused_tools=["lift_shadows"]),
            # micro_contrast → clarity.amount (disjoint with both above)
            Problem(kind="low_contrast", severity=0.8, region_label=None,
                    suggested_fused_tools=["micro_contrast"]),
        ],
        topup_picks=["warm_grade"],
        resolve_values={
            "corrective_kelvin": 0, "sat_correction": 0,
            "shadows": 30, "blacks": 5,
            "amount": 20,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 3
    fake.suggest_fused_tools_for_character.assert_not_called()


def test_analyze_caps_at_max_for_many_problems(monkeypatch) -> None:
    """Many high-severity problems with mutually-disjoint canonical
    targets → problem-driven minting capped at MAX (5). Uses tone_band
    templates which are guaranteed disjoint across bands."""
    fake = _fake_claude_for_topup(
        problems=[
            Problem(kind="strong_color_cast", severity=0.8, region_label=None,
                    suggested_fused_tools=["tone_red"]),
            Problem(kind="strong_color_cast", severity=0.8, region_label="sky",
                    suggested_fused_tools=["tone_blue"]),
            Problem(kind="strong_color_cast", severity=0.8, region_label="leaves",
                    suggested_fused_tools=["tone_green"]),
            Problem(kind="strong_color_cast", severity=0.7, region_label="oranges",
                    suggested_fused_tools=["tone_orange"]),
            Problem(kind="strong_color_cast", severity=0.7, region_label="yellows",
                    suggested_fused_tools=["tone_yellow"]),
            Problem(kind="strong_color_cast", severity=0.6, region_label="aqua",
                    suggested_fused_tools=["tone_aqua"]),
        ],
        topup_picks=[],
        resolve_values={
            "red_hue": 0, "red_sat": 0, "red_lum": 0,
            "blue_hue": 0, "blue_sat": 0, "blue_lum": 0,
            "green_hue": 0, "green_sat": 0, "green_lum": 0,
            "orange_hue": 0, "orange_sat": 0, "orange_lum": 0,
            "yellow_hue": 0, "yellow_sat": 0, "yellow_lum": 0,
            "aqua_hue": 0, "aqua_sat": 0, "aqua_lum": 0,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(autonomous) == 5  # MAX
    fake.suggest_fused_tools_for_character.assert_not_called()


def test_analyze_dedupes_tool_across_problems(monkeypatch) -> None:
    """Two problems both suggesting `cast_correct` first must NOT yield two
    near-identical `cast_correct` widgets. The second falls through to its
    next-best suggestion (here `exposure_balance`)."""
    fake = _fake_claude_for_topup(
        problems=[
            # Both list cast_correct first; if dedup is broken, both mint
            # cast_correct widgets and the visual result is duplicate
            # bindings at different scopes.
            Problem(
                kind="strong_color_cast", severity=0.8,
                region_label="floured table surface",
                suggested_fused_tools=["cast_correct", "cool_grade"],
            ),
            Problem(
                kind="uneven_white_balance", severity=0.5, region_label=None,
                suggested_fused_tools=["cast_correct", "exposure_balance"],
            ),
        ],
        topup_picks=[],
        resolve_values={
            "corrective_kelvin": 0, "sat_correction": 0,
            "temperature": 0, "saturation_lift": 0, "highlight_warmth": 0,
            "shadows": 5, "highlights": -10, "whites": 0, "blacks": 0,
            "highlight_amount": 0.5, "luma_curve_strength": 0.3,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    fused_ids = sorted(w.op_id for w in autonomous)
    # cast_correct is used by the first problem; the second problem falls
    # through to exposure_balance. No duplicates.
    assert fused_ids == ["cast_correct", "exposure_balance"]
    by_tool = {w.op_id: w for w in autonomous}
    # First-pick keeps the problem-kind label.
    assert by_tool["cast_correct"].intent == "strong color cast"
    # Fall-through uses the tool's own label so the widget title matches
    # its controls — "uneven white balance" + exposure_balance sliders
    # would have been a confusing mismatch.
    assert by_tool["exposure_balance"].intent == "Balance exposure"


def test_analyze_dedupes_canonical_knob_collisions(monkeypatch) -> None:
    """Two widgets that bind to the same canonical (op, param) — e.g. all
    three of cast_correct / warm_grade / subject_pop touch `basic.saturation`
    — create duplicate sliders fighting over the same knob. Only the first
    minted widget for any given knob survives."""
    fake = _fake_claude_for_topup(
        problems=[
            # cast_correct → kelvin.temperature + basic.saturation
            Problem(
                kind="strong_color_cast", severity=0.8, region_label=None,
                suggested_fused_tools=["cast_correct"],
            ),
            # warm_grade → kelvin.temperature + basic.highlights +
            # basic.saturation → overlaps on TWO knobs with cast_correct.
            Problem(
                kind="uneven_white_balance", severity=0.6, region_label=None,
                suggested_fused_tools=["warm_grade"],
            ),
            # subject_pop → basic.contrast + basic.saturation → overlaps on
            # basic.saturation with cast_correct.
            Problem(
                kind="low_contrast", severity=0.6, region_label=None,
                suggested_fused_tools=["subject_pop"],
            ),
        ],
        topup_picks=[],
        resolve_values={
            "corrective_kelvin": 0, "sat_correction": 0,
            "temperature": 0, "saturation_lift": 0, "highlight_warmth": 0,
            "contrast_pop": 0, "saturation_pop": 0,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    doc = deps.get_session_store().get_document(sid)
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    fused_ids = sorted(w.op_id for w in autonomous)
    # cast_correct wins; warm_grade + subject_pop both blocked by the
    # basic.saturation knob collision.
    assert "cast_correct" in fused_ids
    assert "warm_grade" not in fused_ids
    assert "subject_pop" not in fused_ids


def test_analyze_skips_dismissed_topup_picks(monkeypatch) -> None:
    """If a dismissal rule already covers a top-up candidate, skip it."""
    from app.schemas.widget import DismissalRule
    fake = _fake_claude_for_topup(
        problems=[],
        topup_picks=["warm_grade", "exposure_balance"],
        resolve_values={
            "temperature": 200, "highlight_warmth": 5, "saturation_lift": 2,
            "shadows": 0, "highlights": 0, "whites": 0, "blacks": 0,
        },
    )
    monkeypatch.setattr(deps, "_anthropic_client", fake)
    sid = _bootstrap_session()
    doc = deps.get_session_store().get_document(sid)
    doc.dismissals.append(DismissalRule(
        id="rule-1", fused_tool_id="warm_grade", scope_signature="global",
        source_widget_id="dummy", intent_norm="",
    ))
    client = TestClient(app)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    autonomous = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    fused_ids = {w.op_id for w in autonomous}
    assert "warm_grade" not in fused_ids
    assert "exposure_balance" in fused_ids
