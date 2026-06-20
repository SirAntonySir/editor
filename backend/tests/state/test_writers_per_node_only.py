"""After the migration, bootstrap writers must NOT touch the legacy
singleton fields on SessionDocument. The per-image-node dicts are the
only canonical storage."""

import pytest

from app.schemas.image_context import ImageContext
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument


def _ctx() -> ImageContext:
    return ImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="calm",
        model_name="m", model_version="v", generated_at="2026-06-15T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_api_session_context_endpoint_writes_per_node_only(monkeypatch):
    """POST /session/{sid}/context must populate image_context_by_node and
    leave doc.image_context untouched."""
    from app.api.session import set_session_context
    from app.services.session_store import SessionStore

    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"X", mime_type="image/jpeg")
    doc_before = store.get_document(sid)
    assert doc_before.image_context is None

    await set_session_context(sid, _ctx(), store=store)

    doc = store.get_document(sid)
    assert doc.image_context is None, "writer must not touch the legacy singleton"
    assert doc.image_context_by_node[DEFAULT_IMAGE_NODE_ID] is not None
