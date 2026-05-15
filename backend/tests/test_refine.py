from __future__ import annotations

from unittest.mock import MagicMock
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.operation_graph import OperationGraph
from app.services.session_store import SessionStore


@pytest.fixture
def client_with_session(monkeypatch, sample_operation_graph, sample_image_context):
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    store.set_context(sid, sample_image_context)
    store.store_graph(sid, "graph_01", sample_operation_graph)

    monkeypatch.setattr(deps, "get_session_store", lambda: store)

    fake = MagicMock()
    fake.generate_refined_panel = MagicMock(
        return_value=OperationGraph.model_validate({**sample_operation_graph, "id": "graph_02"})
    )
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)

    return TestClient(app), sid, fake


def test_refine_happy_path(client_with_session):
    tc, sid, fake = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "graph_02"
    fake.generate_refined_panel.assert_called_once()


def test_refine_stores_new_graph_in_session(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 200
    # Subsequent refine using the new graph id should succeed (proves it was stored)
    r2 = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_02", "instruction": "even subtler"
    })
    assert r2.status_code == 200


def test_refine_404_on_missing_session(client_with_session):
    tc, _, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": "nope", "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 404
    assert "session" in r.json()["detail"]


def test_refine_404_on_missing_graph(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "missing", "instruction": "more subtle"
    })
    assert r.status_code == 404
    assert "graph" in r.json()["detail"]


def test_refine_400_on_empty_instruction(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": ""
    })
    # Pydantic v2 returns 422 for validation errors on body; many FastAPI apps
    # translate min_length to 422 not 400. Accept either.
    assert r.status_code in (400, 422)


def test_refine_400_on_oversize_instruction(client_with_session):
    tc, sid, _ = client_with_session
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "x" * 501
    })
    assert r.status_code in (400, 422)


def test_refine_502_on_anthropic_runtime_error(monkeypatch, sample_operation_graph, sample_image_context):
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    store.set_context(sid, sample_image_context)
    store.store_graph(sid, "graph_01", sample_operation_graph)
    monkeypatch.setattr(deps, "get_session_store", lambda: store)

    fake = MagicMock()
    fake.generate_refined_panel.side_effect = RuntimeError("anthropic down")
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)

    tc = TestClient(app)
    r = tc.post("/api/refine", json={
        "session_id": sid, "prior_graph_id": "graph_01", "instruction": "more subtle"
    })
    assert r.status_code == 502
