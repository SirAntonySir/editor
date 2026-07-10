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
    develop_raw_to_png16,
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


# ---------------- 16-bit PNG develop (Tier 1) ----------------


def test_develop_png16_is_16bit_rgb():
    import cv2
    import numpy as np
    out = develop_raw_to_png16(FIXTURE.read_bytes())
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.dtype == np.uint16          # 16-bit, not truncated to 8
    assert arr.shape == (192, 192, 3)      # full-res, 3-channel


def test_develop_png16_clamps_to_max_dim():
    import cv2
    import numpy as np
    out = develop_raw_to_png16(FIXTURE.read_bytes(), max_dim=64)
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert max(arr.shape[:2]) == 64


def test_develop_png16_rejects_non_raw():
    with pytest.raises(RawDecodeError):
        develop_raw_to_png16(b"not a raw image at all")


# ---------------- plain-TIFF fallback ----------------
# Browsers can't decode TIFF at all, so the frontend routes .tif/.tiff through
# the develop endpoint like RAW. LibRaw rejects plain (non-RAW) TIFFs, so the
# service falls back to a direct TIFF decode — gated on TIFF magic so plain
# JPEG/PNG bytes are still rejected (see test_develop_rejects_a_plain_jpeg).


def _tiff_bytes(arr) -> bytes:
    import cv2
    # Uncompressed: OpenCV defaults float TIFF to lossy SGILOG (LogLuv), which
    # would skew the value assertions. Real HDR exports use none/deflate.
    ok, buf = cv2.imencode(".tiff", arr, [cv2.IMWRITE_TIFF_COMPRESSION, 1])
    assert ok
    return buf.tobytes()


def test_develop_png16_accepts_plain_16bit_tiff():
    import cv2
    import numpy as np
    src = np.full((40, 60, 3), 40_000, dtype=np.uint16)
    out = develop_raw_to_png16(_tiff_bytes(src))
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None
    assert arr.dtype == np.uint16
    assert arr.shape == (40, 60, 3)
    # 16-bit values survive (not truncated to 8-bit then rescaled).
    assert int(arr[0, 0, 0]) == 40_000


def test_develop_png16_accepts_float_hdr_tiff():
    import cv2
    import numpy as np
    # Float TIFF (e.g. HDR export). Values >1 clip; in-gamut values scale.
    src = np.full((16, 16, 3), 0.5, dtype=np.float32)
    src[0, 0] = 4.0  # over-range highlight
    out = develop_raw_to_png16(_tiff_bytes(src))
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr.dtype == np.uint16
    assert int(arr[0, 0, 0]) == 65_535           # clipped highlight
    assert abs(int(arr[1, 1, 0]) - 32_768) <= 1  # 0.5 → mid-range


def test_develop_png16_accepts_8bit_tiff_and_scales_up():
    import cv2
    import numpy as np
    src = np.full((16, 16, 3), 128, dtype=np.uint8)
    out = develop_raw_to_png16(_tiff_bytes(src))
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr.dtype == np.uint16
    assert int(arr[0, 0, 0]) == 128 * 257


def test_develop_png16_tiff_clamps_to_max_dim():
    import cv2
    import numpy as np
    src = np.zeros((100, 200, 3), dtype=np.uint16)
    out = develop_raw_to_png16(_tiff_bytes(src), max_dim=64)
    arr = cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_UNCHANGED)
    assert max(arr.shape[:2]) == 64


def test_develop_jpeg_accepts_plain_tiff():
    import numpy as np
    src = np.full((16, 16, 3), 30_000, dtype=np.uint16)
    out = develop_raw_to_jpeg(_tiff_bytes(src))
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"
    assert img.size == (16, 16)
