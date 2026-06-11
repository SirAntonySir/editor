"""propose_mask: client-side mask commit, dimension extraction, SSE event."""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

from app.tools.atomic.propose_mask import ProposeMaskTool, _Input


def _make_png_b64(width: int = 32, height: int = 16) -> str:
    """Return a base64-encoded grayscale PNG of the given dimensions."""
    img = Image.new("L", (width, height), color=255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


@pytest.mark.asyncio
async def test_propose_mask_happy_path(make_doc) -> None:
    """Valid input returns a maskId starting with 'client-' and record appears
    in doc.masks with the correct source for 'client_refinement'."""
    doc = make_doc()
    b64 = _make_png_b64(64, 48)

    out = await ProposeMaskTool().handler(
        doc,
        _Input(
            image_node_id="node-1",
            png_base64=b64,
            paths=[[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
            label="dog",
            origin="client_refinement",
        ),
    )

    assert out.mask_id.startswith("client-")
    assert out.mask_id in doc.masks

    record = doc.masks[out.mask_id]
    assert record.source == "sam_box"
    assert record.label == "dog"
    assert record.width == 64
    assert record.height == 48

    # A mask.created event should have been emitted by doc.add_mask, and a
    # mask.proposed event by the tool itself.
    kinds = [ev.kind for ev in doc.history]
    assert "mask.created" in kinds
    assert "mask.proposed" in kinds


@pytest.mark.asyncio
async def test_propose_mask_empty_png_raises(make_doc) -> None:
    """An empty / non-PNG base64 payload should raise ValueError."""
    doc = make_doc()
    # base64-encode an empty bytes object — valid base64 but not a PNG.
    bad_b64 = base64.b64encode(b"not-a-png").decode()

    with pytest.raises(ValueError, match="propose_mask"):
        await ProposeMaskTool().handler(
            doc,
            _Input(
                image_node_id="node-1",
                png_base64=bad_b64,
                origin="client_new",
            ),
        )


@pytest.mark.asyncio
async def test_propose_mask_dimensions(make_doc) -> None:
    """Decoded PNG dimensions must match record.width / record.height."""
    doc = make_doc()
    b64 = _make_png_b64(width=32, height=16)

    out = await ProposeMaskTool().handler(
        doc,
        _Input(
            image_node_id="node-2",
            png_base64=b64,
            origin="client_extracted",
        ),
    )

    record = doc.masks[out.mask_id]
    assert record.width == 32
    assert record.height == 16
    # origin falls back to sam_point for client_extracted
    assert record.source == "sam_point"
