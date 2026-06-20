from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_session_create_returns_id() -> None:
    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        response = client.post(
            "/api/session",
            files={"image": ("test.jpg", fh, "image/jpeg")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "session_id" in body
    assert len(body["session_id"]) == 32


def test_session_rejects_oversized_image(monkeypatch) -> None:
    # Force a tiny limit
    from app import config
    monkeypatch.setattr(config.get_settings(), "max_image_bytes", 10)
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("big.jpg", b"x" * 100, "image/jpeg")},
    )
    assert response.status_code == 413


def test_session_rejects_non_image_mime() -> None:
    client = TestClient(app)
    response = client.post(
        "/api/session",
        files={"image": ("file.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 415


def test_cancel_unknown_session_returns_404() -> None:
    client = TestClient(app)
    response = client.post("/api/session/does-not-exist/cancel")
    assert response.status_code == 404


def test_cancel_with_no_active_task_returns_not_cancelled() -> None:
    """POST /session/{sid}/cancel on a valid session with nothing running is
    idempotent and reports `cancelled: false`."""
    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        create = client.post("/api/session", files={"image": ("test.jpg", fh, "image/jpeg")})
    sid = create.json()["session_id"]

    response = client.post(f"/api/session/{sid}/cancel")
    assert response.status_code == 200, response.text
    assert response.json() == {"cancelled": False}


def test_session_round_trip_persists_through_simulated_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End-to-end Phase 2 verification: create a session via HTTP, mutate
    its canonical state, checkpoint to disk, then drop the in-memory store
    and revive a fresh one from disk. GET /api/state/{sid} on the revived
    store must return the same operationGraph the mutated session had —
    proving the persistence + revive trio survives a backend restart.
    """
    from app.api import deps
    from app.services import disk_session_io
    from app.services.session_store import SessionStore
    from app.session import revive

    # All disk I/O lands under tmp_path so this test doesn't pollute the
    # real .sessions/ dir.
    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)

    # Boot a fresh SessionStore for this test so we don't share state with
    # any other test or with the long-lived module-level singleton.
    pre_restart_store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", pre_restart_store)

    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"

    # --- 1. create session via HTTP ---
    with image_path.open("rb") as fh:
        create = client.post(
            "/api/session",
            files={"image": ("test.jpg", fh, "image/jpeg")},
        )
    assert create.status_code == 200, create.text
    sid = create.json()["session_id"]

    # --- 2. mutate the document directly (no analyze tool needed) ---
    doc = pre_restart_store.get_document(sid)
    doc.set_param("layer-1", "basic", "exposure", 0.42)
    doc.set_param("layer-1", "basic", "contrast", 0.25)
    pre_revision = doc.revision

    # --- 3. force a synchronous flush to disk ---
    pre_restart_store.checkpointer.flush_now(doc)

    # --- 4. "restart": drop the in-memory store, build a fresh one,
    #        revive from disk, swap into deps. ---
    revived_store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", revived_store)

    revived = revive.revive_all(revived_store)
    assert revived == 1, "expected the just-flushed session to revive"

    # --- 5. fetch the snapshot via HTTP and assert the mutations survived ---
    response = client.get(f"/api/state/{sid}")
    assert response.status_code == 200, response.text
    snap = response.json()
    assert snap["sessionId"] == sid
    assert snap["revision"] == pre_revision

    # The operation_graph projection must reflect both set_param calls.
    nodes = snap["operationGraph"]["nodes"]
    basic_node = next(
        (n for n in nodes if n.get("layerId") == "layer-1" and n["type"] == "basic"),
        None,
    )
    assert basic_node is not None, f"no basic node for layer-1 in {nodes}"
    assert basic_node["params"]["exposure"] == 0.42
    assert basic_node["params"]["contrast"] == 0.25


def test_session_round_trip_skips_unflushed_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the session was created but no checkpoint ever fired (no tool
    invocation, no manual flush), the revive scan skips it. The next call
    still works via the lazy on-demand hydration path inside
    SessionStore.get() — but the document state is gone (revision 0).
    Guards us against accidentally promoting `revive` into a 'safety net'
    for never-flushed sessions and masking a regression in the
    checkpointer trigger.
    """
    from app.api import deps
    from app.services import disk_session_io
    from app.services.session_store import SessionStore
    from app.session import revive

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)

    pre_restart_store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", pre_restart_store)

    client = TestClient(app)
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        create = client.post(
            "/api/session",
            files={"image": ("test.jpg", fh, "image/jpeg")},
        )
    sid = create.json()["session_id"]

    # NO mutation, NO checkpoint.

    revived_store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", revived_store)
    assert revive.revive_all(revived_store) == 0

    # The image + meta are on disk via disk_session_io, so the lazy fetch
    # still hydrates a clean document — but revision is 0 and the
    # operationGraph is empty.
    response = client.get(f"/api/state/{sid}")
    assert response.status_code == 200, response.text
    snap = response.json()
    assert snap["revision"] == 0
    assert snap["operationGraph"]["nodes"] == []
