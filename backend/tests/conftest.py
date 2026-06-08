import pytest


@pytest.fixture
def make_doc():
    """Factory that returns a fresh SessionDocument for unit tests that call
    tool handlers directly (without the HTTP/registry layer)."""
    from app.state.document import SessionDocument

    def _factory(session_id: str = "test-session") -> SessionDocument:
        return SessionDocument(
            session_id=session_id,
            image_bytes=b"\xff\xd8\xff",  # minimal non-empty bytes
            mime_type="image/jpeg",
        )

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
