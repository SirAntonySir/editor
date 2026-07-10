"""Camera-RAW → JPEG develop service.

The browser can't decode camera RAW (`createImageBitmap` only handles
web-native formats), so RAW files are developed here, server-side, via LibRaw
(`rawpy`) and handed back as an ordinary JPEG the frontend can open through its
normal image path.

Strategy (cheap → expensive):
  1. **Embedded preview** — most RAWs embed a JPEG preview. We use it ONLY when
     it's near full sensor resolution (Canon/Nikon embed full-size previews;
     Sony embeds a small ~1616×1080 one). Near-instant, no demosaic.
  2. **Demosaic** — no usable (large enough) preview ⇒ `postprocess()` debayers
     the sensor mosaic into 8-bit sRGB at full resolution.

The preview must clear `_PREVIEW_MIN_FRACTION` of the sensor's long edge or we
demosaic instead — otherwise a 24 MP RAW would silently open as a 1.7 MP
thumbnail. Output is re-encoded to a (large) size-clamped JPEG.

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


# Use an embedded preview only if its long edge is at least this fraction of
# the sensor's long edge — otherwise demosaic for full resolution.
_PREVIEW_MIN_FRACTION = 0.8


class RawDecodeError(ValueError):
    """Raised when bytes can't be read as a camera-RAW image. Transport layers
    translate this to a 4xx (unsupported media)."""


def _is_tiff(data: bytes) -> bool:
    """TIFF magic (little/big endian). Note: many RAWs (NEF/CR2/ARW/DNG) are
    TIFF containers with this same magic, so this must only gate the *fallback*
    after rawpy has already declined — never route around rawpy on it."""
    return data[:4] in (b"II*\x00", b"MM\x00*")


def _decode_tiff_bgr16(data: bytes):
    """Decode a plain (non-RAW) TIFF into a uint16 BGR array.

    Browsers can't decode TIFF at all, so the frontend ships .tif/.tiff here
    like RAW. Handles 8-bit (scaled up), 16-bit (as-is) and float/HDR TIFFs
    (values clipped to [0, 1] then scaled — over-range highlights clip, which
    matches the display-referred pipeline downstream). Grayscale and alpha
    variants are normalised to 3-channel. Raises RawDecodeError when the bytes
    don't decode.
    """
    import cv2
    import numpy as np

    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_UNCHANGED)
    if arr is None:
        raise RawDecodeError("not a readable TIFF image")

    if arr.dtype == np.uint8:
        arr = arr.astype(np.uint16) * 257
    elif arr.dtype in (np.float32, np.float64):
        arr = (np.clip(arr, 0.0, 1.0) * 65535.0 + 0.5).astype(np.uint16)
    elif arr.dtype != np.uint16:
        raise RawDecodeError(f"unsupported TIFF sample type: {arr.dtype}")

    if arr.ndim == 2:
        arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
    elif arr.shape[2] == 4:
        arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2BGR)
    return arr


def _tiff_to_pil_rgb(data: bytes) -> Image.Image:
    """Plain TIFF → 8-bit RGB PIL image (the JPEG develop path's currency)."""
    import cv2

    bgr = _decode_tiff_bgr16(data)
    return Image.fromarray(cv2.cvtColor((bgr // 257).astype("uint8"), cv2.COLOR_BGR2RGB))


def _clamp_long_edge(arr, max_dim: int):
    """Downscale so the long edge fits `max_dim`; unchanged when it already does."""
    import cv2

    h, w = arr.shape[:2]
    longest = max(h, w)
    if longest <= max_dim:
        return arr
    scale = max_dim / longest
    return cv2.resize(
        arr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA
    )


def is_raw_filename(name: str) -> bool:
    """Cheap routing check: does the filename carry a known RAW extension?"""
    dot = name.rfind(".")
    if dot == -1:
        return False
    return name[dot:].lower() in RAW_EXTENSIONS


def develop_raw_to_jpeg(data: bytes, *, max_dim: int = 8192, quality: int = 92) -> bytes:
    """Develop RAW `data` into a JPEG byte string.

    Uses the embedded preview when it's near full sensor resolution, else
    demosaics at full resolution. The result is converted to RGB, downscaled
    only if its longest side exceeds `max_dim` (default high, so typical
    cameras keep full resolution), and JPEG-encoded at `quality`. Raises
    `RawDecodeError` if `data` isn't a readable RAW.
    """
    # Imported lazily so the rest of the backend doesn't pay the LibRaw import
    # cost unless a RAW actually arrives.
    import rawpy

    try:
        with rawpy.imread(io.BytesIO(data)) as raw:
            sensor_long = max(raw.sizes.width, raw.sizes.height)
            preview = _embedded_preview(raw)
            if preview is not None and max(preview.size) >= _PREVIEW_MIN_FRACTION * sensor_long:
                img = preview
            else:
                img = _demosaic(raw)
            # Force pixel materialisation while `raw` is still open (Image.open
            # on the embedded preview is lazy), then detach to RGB.
            img = img.convert("RGB")
    except RawDecodeError:
        raise
    except Exception as exc:  # rawpy raises LibRaw* errors for non-RAW input
        if not _is_tiff(data):
            raise RawDecodeError(f"not a readable RAW image: {exc}") from exc
        # Plain (non-RAW) TIFF — browsers can't decode TIFF, so the frontend
        # ships it here like RAW. rawpy declined, so decode it directly.
        img = _tiff_to_pil_rgb(data)

    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


def develop_raw_to_png16(data: bytes, *, max_dim: int = 8192) -> bytes:
    """Develop RAW `data` into a **16-bit** sRGB PNG byte string.

    Always demosaics at full depth (`output_bps=16`) — embedded previews are
    8-bit JPEGs, so they're never used here. Output is sRGB-gamma-encoded (same
    domain as the 8-bit JPEG path, just 16-bit precision), so the editor's
    gamma-domain pipeline can consume it unchanged. Downscaled in 16-bit only
    if the long edge exceeds `max_dim`. Raises `RawDecodeError` for non-RAW.

    Encoded with OpenCV — Pillow can't write 16-bit RGB PNG. `cv2` wants BGR.
    """
    import cv2
    import numpy as np
    import rawpy

    try:
        with rawpy.imread(io.BytesIO(data)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, output_bps=16, no_auto_bright=False)
    except Exception as exc:  # rawpy raises LibRaw* errors for non-RAW input
        if not _is_tiff(data):
            raise RawDecodeError(f"not a readable RAW image: {exc}") from exc
        # Plain (non-RAW) TIFF — browsers can't decode TIFF, so the frontend
        # ships it here like RAW. rawpy declined, so decode it directly.
        # Already BGR + uint16, so it skips the RGB→BGR conversion below.
        rgb = None

    if rgb is not None:
        rgb = _clamp_long_edge(rgb, max_dim)
        # Rebind to the BGR result so the (full-size, ~w*h*3*2 bytes) RGB source
        # is freed immediately instead of living alongside the BGR copy through
        # the encode. On a 24MP RAW that's ~144 MB reclaimed before imencode
        # runs — the headroom that keeps peak heap well under the instance
        # limit.
        rgb = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    else:
        rgb = _clamp_long_edge(_decode_tiff_bgr16(data), max_dim)
    # Compression 6 trades a little CPU for a much smaller payload than the
    # default (level 1) — a 24MP 16-bit PNG is tens of MB either way, but this
    # meaningfully cuts the transfer + in-memory File size.
    ok, buf = cv2.imencode(".png", rgb, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise RawDecodeError("failed to encode 16-bit PNG")
    return np.asarray(buf).tobytes()


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
