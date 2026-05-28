import pytest
from unittest.mock import MagicMock
import numpy as np
from app.tools.atomic.analyze_image import _precompute_region_masks
from app.state.document import SessionDocument
from app.schemas.image_context import CandidateRegion


@pytest.mark.asyncio
async def test_precompute_decodes_each_candidate_region():
    doc = SessionDocument(session_id="s1", image_bytes=b"\x89PNG\r\n\x1a\n", mime_type="image/png")
    regions = [
        CandidateRegion(label="sky", description="", bbox=[0.0, 0.0, 1.0, 0.5],
                        representative_point=[0.5, 0.25]),
        CandidateRegion(label="ground", description="", bbox=[0.0, 0.5, 1.0, 1.0],
                        representative_point=[0.5, 0.75]),
    ]
    sam = MagicMock()
    sam.decode_box_for_region.side_effect = [
        (np.zeros((10, 10), dtype="uint8"), "m_sky"),
        (np.zeros((10, 10), dtype="uint8"), "m_ground"),
    ]
    progress_calls: list[tuple[int, int]] = []
    orig_emit = doc._emit
    def _capture(kind, payload):
        if kind == "phase.progress":
            progress_calls.append((payload["done"], payload["total"]))
        return orig_emit(kind, payload)
    doc._emit = _capture  # type: ignore[method-assign]

    await _precompute_region_masks(doc, regions, sam)

    assert sam.decode_box_for_region.call_count == 2
    assert any(done >= 1 for done, _ in progress_calls)


@pytest.mark.asyncio
async def test_precompute_skips_failing_region():
    doc = SessionDocument(session_id="s1", image_bytes=b"\x89PNG\r\n\x1a\n", mime_type="image/png")
    regions = [
        CandidateRegion(label="sky", description="", bbox=[0.0, 0.0, 1.0, 0.5],
                        representative_point=[0.5, 0.25]),
        CandidateRegion(label="bad", description="", bbox=[0.0, 0.5, 1.0, 1.0],
                        representative_point=[0.5, 0.75]),
    ]
    sam = MagicMock()
    sam.decode_box_for_region.side_effect = [
        (np.zeros((10, 10), dtype="uint8"), "m_sky"),
        RuntimeError("decode failed"),
    ]
    await _precompute_region_masks(doc, regions, sam)
    assert sam.decode_box_for_region.call_count == 2
