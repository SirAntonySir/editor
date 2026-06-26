"""RAW develop service — detect camera-RAW files and decode them to a JPEG
preview (embedded-thumbnail fast path, demosaic fallback)."""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.services.raw_decode import (
    RawDecodeError,
    develop_raw_to_jpeg,
    is_raw_filename,
)

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "synthetic.dng"


def test_is_raw_filename_detects_common_extensions():
    assert is_raw_filename("photo.dng")
    assert is_raw_filename("IMG.CR2")        # case-insensitive
    assert is_raw_filename("a/b/shot.nef")
    assert not is_raw_filename("photo.jpg")
    assert not is_raw_filename("photo.png")
    assert not is_raw_filename("noext")


def test_develop_synthetic_dng_returns_a_jpeg():
    out = develop_raw_to_jpeg(FIXTURE.read_bytes())
    assert isinstance(out, bytes) and len(out) > 0
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.mode == "RGB"
    # Synthetic DNG has no embedded preview → demosaic path → full 192×192.
    assert img.size == (192, 192)


def test_develop_clamps_to_max_dim():
    out = develop_raw_to_jpeg(FIXTURE.read_bytes(), max_dim=64)
    img = Image.open(io.BytesIO(out))
    assert max(img.size) == 64


def test_develop_rejects_non_raw_bytes():
    with pytest.raises(RawDecodeError):
        develop_raw_to_jpeg(b"this is definitely not a raw image")


def test_develop_rejects_a_plain_jpeg():
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 20, 30)).save(buf, format="JPEG")
    with pytest.raises(RawDecodeError):
        develop_raw_to_jpeg(buf.getvalue())
