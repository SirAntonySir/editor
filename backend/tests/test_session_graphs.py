import pytest
from app.services.session_store import SessionStore, SessionNotFound


def test_store_and_get_graph_round_trip():
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    graph = {"id": "g1", "user_goal": "warmer"}
    store.store_graph(sid, "g1", graph)
    assert store.get_graph(sid, "g1") == graph


def test_get_graph_returns_none_for_unknown_id():
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    assert store.get_graph(sid, "missing") is None


def test_store_graph_raises_for_unknown_session():
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.store_graph("nope", "g1", {"id": "g1"})


def test_get_graph_raises_for_unknown_session():
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.get_graph("nope", "g1")
