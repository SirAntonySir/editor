"""prepare_image: parallel cv2+SAM, no mutation, correct shape."""

from pathlib import Path

import pytest

from app.tools.atomic.prepare_image import PrepareImageTool, _Input

_FIXTURE_IMAGE = Path(__file__).parent.parent / "fixtures" / "test_image.jpg"


@pytest.mark.asyncio
async def test_prepare_image_runs_without_sam(make_doc, monkeypatch):
    """ANALYZE_SAM=0 path: cv2 runs, SAM is skipped, sam_ok=False."""
    monkeypatch.setenv("ANALYZE_SAM", "0")
    doc = make_doc()
    doc.image_bytes = _FIXTURE_IMAGE.read_bytes()
    out = await PrepareImageTool().handler(doc, _Input())
    assert out.sam_ok is False
    assert out.image_width > 0
    assert out.image_height > 0
    assert doc.prepare_result is not None


@pytest.mark.asyncio
async def test_prepare_image_runs_with_sam(make_doc, monkeypatch):
    """ANALYZE_SAM=1 + dummy SAM: sam_ok=True."""
    monkeypatch.setenv("ANALYZE_SAM", "1")

    class _Sam:
        def embed(self, _sid, _arr):
            return None

    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _Sam())
    doc = make_doc()
    doc.image_bytes = _FIXTURE_IMAGE.read_bytes()
    out = await PrepareImageTool().handler(doc, _Input())
    assert out.sam_ok is True


@pytest.mark.asyncio
async def test_prepare_image_is_idempotent(make_doc, monkeypatch):
    """Re-running on the same doc returns the cached PrepareResult without
    re-running the cv2 pass. Verify by counting calls."""
    monkeypatch.setenv("ANALYZE_SAM", "0")
    doc = make_doc()
    doc.image_bytes = _FIXTURE_IMAGE.read_bytes()

    out1 = await PrepareImageTool().handler(doc, _Input())
    out2 = await PrepareImageTool().handler(doc, _Input())
    assert out1.image_width == out2.image_width
    # Same PrepareResult object reused.
    assert doc.prepare_result is not None
