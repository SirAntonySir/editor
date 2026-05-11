import pytest


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
