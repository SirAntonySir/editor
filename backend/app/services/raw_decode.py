"""Camera-RAW → JPEG develop service.

The browser can't decode camera RAW (`createImageBitmap` only handles
web-native formats), so RAW files are developed here, server-side, via LibRaw
(`rawpy`) and handed back as an ordinary JPEG the frontend can open through its
normal image path.

Strategy (cheap → expensive):
  1. **Embedded preview** — virtually every RAW embeds a full-size JPEG. If
     present we use it: no demosaic, near-instant. This is the MVP path.
  2. **Demosaic fallback** — no usable preview ⇒ `postprocess()` debayers the
     sensor mosaic into 8-bit sRGB.

Output is always re-encoded to a size-clamped JPEG so callers get a uniform
result regardless of which path produced it.

Note: the 8-bit JPEG output discards RAW's 12–16-bit latitude — fine for
"open and view/edit like a JPEG", not for true highlight/shadow recovery
(that needs `output_bps=16` and a higher-bit-depth pipeline).
"""

from __future__ import annotations

import io

from PIL import Image

# LibRaw reads many more formats than this; the extension set is only used for
# the cheap up-front "is this a RAW?" routing decision. The authoritative test
# is whether `rawpy` can actually open the bytes (see develop_raw_to_jpeg).
RAW_EXTENSIONS = frozenset({
    ".dng", ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".sr2", ".srf",
    ".raf", ".orf", ".rw2", ".pef", ".srw", ".raw", ".3fr", ".erf", ".kdc",
    ".mos", ".mrw", ".dcr", ".x3f", ".iiq", ".rwl",
})


class RawDecodeError(ValueError):
    """Raised when bytes can't be read as a camera-RAW image. Transport layers
    translate this to a 4xx (unsupported media)."""


def is_raw_filename(name: str) -> bool:
    """Cheap routing check: does the filename carry a known RAW extension?"""
    dot = name.rfind(".")
    if dot == -1:
        return False
    return name[dot:].lower() in RAW_EXTENSIONS


def develop_raw_to_jpeg(data: bytes, *, max_dim: int = 2048, quality: int = 90) -> bytes:
    """Develop RAW `data` into a JPEG byte string.

    Prefers the embedded preview; falls back to a full demosaic. The result is
    converted to RGB, downscaled so its longest side is ≤ `max_dim`, and
    JPEG-encoded at `quality`. Raises `RawDecodeError` if `data` isn't a
    readable RAW.
    """
    # Imported lazily so the rest of the backend doesn't pay the LibRaw import
    # cost unless a RAW actually arrives.
    import rawpy

    try:
        with rawpy.imread(io.BytesIO(data)) as raw:
            img = _embedded_preview(raw) or _demosaic(raw)
            # Force pixel materialisation while `raw` is still open (Image.open
            # on the embedded preview is lazy), then detach to RGB.
            img = img.convert("RGB")
    except RawDecodeError:
        raise
    except Exception as exc:  # rawpy raises LibRaw* errors for non-RAW input
        raise RawDecodeError(f"not a readable RAW image: {exc}") from exc

    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def _embedded_preview(raw) -> Image.Image | None:
    """Return the RAW's embedded preview as a PIL image, or None when absent."""
    import rawpy

    try:
        thumb = raw.extract_thumb()
    except Exception:
        return None
    if thumb.format == rawpy.ThumbFormat.JPEG:
        return Image.open(io.BytesIO(thumb.data))
    if thumb.format == rawpy.ThumbFormat.BITMAP:
        return Image.fromarray(thumb.data)
    return None


def _demosaic(raw) -> Image.Image:
    """Debayer the sensor mosaic into an 8-bit sRGB image."""
    rgb = raw.postprocess(use_camera_wb=True, output_bps=8, no_auto_bright=False)
    return Image.fromarray(rgb)
