from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext


# ---------------------------------------------------------------------------
# Why this test file looks different from the legacy version
#
# `/api/refine` is now a shim that invokes refine_widget via the tool registry.
# The registry is bound to the module-level deps._session_store at import time,
# so swapping `deps.get_session_store` for a fresh store in fixtures does NOT
# reach the registry — refine_widget would resolve to the original store and
# 404. Instead we use the real store + real session-creation flow + monkeypatch
# only the Anthropic client and the SAM client.
#
# We also pre-populate the document with one active widget so refine_widget has
# something to act on (the legacy `/api/refine` accepted a prior_graph_id and
# pulled the graph from the store; the shim iterates active widgets).
# ---------------------------------------------------------------------------


def _build_soft_fields_stub():
    from app.services.anthropic_client import _ContextSoftFields
    return _ContextSoftFields(
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=1.0,
        grade_character="neutral",
        problems=[],
        region_soft_fields=[],
    )


def _build_fake_anthropic() -> MagicMock:
    from app.schemas.image_context import ImageContext
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext.model_validate({
        "subjects": [],
        "lighting": "flat",
        "dominant_tones": [],
        "mood": "neutral",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    fake.augment_context_soft_fields.return_value = _build_soft_fields_stub()
    fake.name_pick_fused_tool.return_value = "warm_grade"
    fake.resolve_fused_tool.return_value = {
        "values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3},
        "reasoning": "image is cool",
    }
    return fake


@pytest.fixture
def fake_client() -> MagicMock:
    return _build_fake_anthropic()


@pytest.fixture
def client(fake_client: MagicMock, monkeypatch) -> TestClient:
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake_client)
    return TestClient(app)


def _create_session_with_active_widget(client: TestClient) -> tuple[str, str]:
    """Create a real session via /api/session, prime context, spawn one warm_grade
    widget directly via run_fused_tool (propose_widget is now filter-only), and
    return (session_id, widget_id).

    We still go through run_fused_tool so resolve_fused_tool is called once here
    and once inside the /api/refine shim, keeping the call_count >= 2 assertion."""
    import asyncio
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    # Prime context directly on the document — avoids calling SAM via /api/analyze.
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))
    # Mint a warm_grade widget directly via the fused framework so the shim has
    # something to refine and resolve_fused_tool is invoked once here.
    templates = {t.id: t for t in all_fused_templates()}
    template = templates["warm_grade"]
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt=None)
    anthropic = deps.get_anthropic_client()
    widget = asyncio.get_event_loop().run_until_complete(
        run_fused_tool(template, intent="warmer", scope=scope, ctx=ctx,
                       prior=None, instruction=None, anthropic=anthropic, origin=origin)
    )
    doc.add_widget(widget)
    return sid, widget.id


def test_refine_happy_path(client: TestClient, fake_client: MagicMock) -> None:
    sid, _wid = _create_session_with_active_widget(client)
    # prior_graph_id is preserved in the wire shape but no longer validated.
    r = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "anything", "instruction": "more subtle"
    })
    assert r.status_code == 200, r.text
    # Deprecation headers from the shim.
    assert r.headers.get("Deprecation") == "true"
    body = r.json()
    # Structural assertions — graph id is now a projection-generated UUID, not "graph_02".
    assert "id" in body and body["id"].startswith("projected-")
    assert "userGoal" in body
    assert isinstance(body["panelBindings"], list)
    assert len(body["panelBindings"]) > 0
    # resolve_fused_tool runs once during propose, once during refine.
    assert fake_client.resolve_fused_tool.call_count >= 2


def test_refine_can_be_called_repeatedly(client: TestClient) -> None:
    """Replaces the legacy `stores_new_graph_in_session` test. Graphs are no
    longer stored by id; two consecutive refines must both succeed and produce
    a fresh projection each time."""
    sid, _wid = _create_session_with_active_widget(client)
    r1 = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "x", "instruction": "more subtle"
    })
    assert r1.status_code == 200, r1.text
    r2 = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "x", "instruction": "even subtler"
    })
    assert r2.status_code == 200, r2.text


def test_refine_404_on_missing_session(client: TestClient) -> None:
    r = client.post("/api/refine", json={
        "session_id": "nope", "prior_graph_id": "x", "instruction": "more subtle"
    })
    assert r.status_code == 404
    assert "session" in r.json()["detail"].lower()


# NOTE: Legacy `test_refine_404_on_missing_graph` is deliberately removed.
# The new shim does not validate `prior_graph_id` against a stored graph row —
# Plan 3 removes the graph-id storage entirely. The field is preserved in the
# request schema only for wire compatibility.


def test_refine_400_on_empty_instruction(client: TestClient) -> None:
    sid, _wid = _create_session_with_active_widget(client)
    r = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "x", "instruction": ""
    })
    # Pydantic v2 returns 422 for body validation errors.
    assert r.status_code in (400, 422)


def test_refine_400_on_oversize_instruction(client: TestClient) -> None:
    sid, _wid = _create_session_with_active_widget(client)
    r = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "x", "instruction": "x" * 501
    })
    assert r.status_code in (400, 422)


def test_refine_502_on_anthropic_runtime_error(
    client: TestClient, fake_client: MagicMock, monkeypatch
) -> None:
    """The fused-tool framework swallows resolver exceptions and seeds from
    envelope midpoints, so making fake.resolve_fused_tool raise alone won't
    surface a 502. We patch refine_widget's run_fused_tool symbol directly to
    simulate an unrecoverable failure inside the tool handler — the registry
    classifies the bare RuntimeError as internal_error, which the shim maps
    to HTTP 502."""
    sid, _wid = _create_session_with_active_widget(client)

    async def _boom(*args, **kwargs):
        raise RuntimeError("anthropic down")

    monkeypatch.setattr("app.tools.widgets.refine_widget.run_fused_tool", _boom)

    r = client.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "x", "instruction": "more subtle"
    })
    assert r.status_code == 502, r.text
