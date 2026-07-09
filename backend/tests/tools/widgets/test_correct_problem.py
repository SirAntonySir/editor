"""correct_problem — the Info tab's "Correct" button. Resolves the problem's
primary suggested fused template against the cached image context and mints
the widget directly onto the canvas (origin tool_invoked — an explicit user
action, never a pending suggestion chip)."""
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.correct_problem import CorrectProblemTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"highlights": -30, "whites": -20},
            "reasoning": "grounded in the blown sky",
        }


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "correct_problem" not in reg._tools:
        reg.register(CorrectProblemTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext, Problem
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-07-09T00:00:00Z",
        problems=[
            Problem(kind="clipped_highlights", severity=0.9, region_label="sky",
                    suggested_fused_tools=["recover_highlights"],
                    display_label="Blown-out sky"),
        ],
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))
    return sid


def _invoke(client, sid: str, input: dict) -> dict:
    return client.post(
        "/api/tools/correct_problem",
        json={"session_id": sid, "input": input},
    ).json()


def test_mints_the_primary_correction_onto_the_canvas(client):
    sid = _setup(client)

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is True
    widget = env["output"]["widget"]
    # tool_invoked → the frontend tethers it straight onto the canvas,
    # never a pending suggestion chip.
    assert widget["origin"]["kind"] == "tool_invoked"
    assert widget["status"] == "active"
    assert all(n["layerId"] == "l-1" for n in widget["nodes"])
    # The card reads as the problem, not the internal template id.
    assert widget["displayName"] == "Blown-out sky"
    # It landed in the document.
    doc = deps.get_session_store().get_document(sid)
    assert widget["id"] in doc.widgets


def test_unknown_problem_errors_cleanly(client):
    sid = _setup(client)
    env = _invoke(client, sid, {
        "problemKind": "crushed_shadows",
        "regionLabel": None,
        "layerId": "l-1",
    })
    assert env["ok"] is False
