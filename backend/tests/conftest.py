import pytest


@pytest.fixture
def make_doc():
    """Factory that returns a fresh SessionDocument for unit tests that call
    tool handlers directly (without the HTTP/registry layer).

    Pass ``with_image_context=True`` to attach a minimal :class:`ImageContext`
    so that LLM-path tools (e.g. ``ProposeStackTool``) don't raise
    ``_MissingContext`` before reaching the monkeypatched Anthropic client.
    """
    from app.schemas.image_context import ImageContext
    from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument

    def _factory(
        session_id: str = "test-session",
        *,
        with_image_context: bool = False,
    ) -> SessionDocument:
        doc = SessionDocument(
            session_id=session_id,
            image_bytes=b"\xff\xd8\xff",  # minimal non-empty bytes
            mime_type="image/jpeg",
        )
        if with_image_context:
            doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ImageContext(
                subjects=["subject"],
                lighting="flat",
                dominant_tones=["midtones"],
                mood="neutral",
                candidate_regions=[],
                model_name="claude-opus-4-7",
                model_version="2026-01",
                generated_at="2026-01-01T00:00:00Z",
            ))
        return doc

    return _factory


@pytest.fixture
def sample_operation_graph() -> dict:
    return {
        "id": "graph_01",
        "user_goal": "make it warmer",
        "reasoning": "Image is cool-toned, warming the white balance addresses this directly.",
        "nodes": [
            {
                "id": "n1",
                "type": "kelvin",
                "scope": {"kind": "global"},
                "params": {"temperature": 5800},
                "layer_id": "layer_01",
                "widget_id": "widget_01",
            }
        ],
        "panel_bindings": [
            {
                "node_id": "n1",
                "param_key": "temperature",
                "label": "warm cast",
                "control": "slider",
                "min": 3000,
                "max": 9000,
                "default": 5800,
                "step": 50,
            }
        ],
        "metadata": {"model_name": "claude-opus-4-7", "model_version": "2026-01"},
    }


@pytest.fixture
def sample_image_context() -> dict:
    return {
        "subjects": ["person", "snow"],
        "lighting": "backlit",
        "dominant_tones": ["shadows", "highlights"],
        "mood": "wintry, intimate",
        "candidate_regions": [
            {"label": "subject", "description": "person in centre frame"},
            {"label": "sky", "description": "upper third"},
        ],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    }


@pytest.fixture(autouse=True)
def _isolated_sessions_dir(tmp_path, monkeypatch):
    """Redirect ALL on-disk session I/O to a per-test temp dir.

    TestClient-based tests create real sessions through POST /api/session;
    without this redirect every suite run wrote ~100 junk sessions (1-byte
    fixture images) into the developer's live backend/.sessions, which then
    surfaced as phantom "users" in the admin views. Every consumer reads
    `disk_session_io.SESSIONS_DIR` at call time (never imports the name
    directly), so one module-attribute patch isolates the whole tree —
    meta.json, events.jsonl, assets, and per-node images alike. Tests that
    patch SESSIONS_DIR themselves simply override this (their setattr runs
    later inside the test body).
    """
    monkeypatch.setattr(
        "app.services.disk_session_io.SESSIONS_DIR", tmp_path / "sessions",
    )
