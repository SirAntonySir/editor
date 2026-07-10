from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from app.schemas.widget import Widget

_SUPPORTED_NODE_TYPES = {"kelvin", "basic", "curves", "levels"}


def _decode_downscaled(image_bytes: bytes, max_dim: int) -> np.ndarray:
    """Decode to a downscaled float [0,1] RGB array."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img.thumbnail((max_dim, max_dim), Image.BILINEAR)
    return np.array(img).astype(np.float32) / 255.0


def _effective_params(widget: Widget) -> dict[str, dict]:
    """Per-node param dict with binding values overlaid.

    Fused widgets store resolved values on their BINDINGS (target.node_id +
    target.param_key + value), leaving node.params empty; only the frontend
    reconciles the two at render time. Without this overlay the CPU preview
    would read the empty node.params and render a no-op for every fused
    widget. Node.params is the base; a binding value for the same key wins."""
    params: dict[str, dict] = {n.id: dict(n.params) for n in widget.nodes}
    for b in widget.bindings:
        node_id = b.target.node_id
        if node_id in params:
            params[node_id][b.target.param_key] = b.value
    return params


def _apply_widget_nodes(arr: np.ndarray, widget: Widget) -> np.ndarray:
    """Apply every node's op to `arr` in order. Assumes all node types are
    supported (callers gate on `_SUPPORTED_NODE_TYPES` first)."""
    eff = _effective_params(widget)
    for n in widget.nodes:
        p = eff[n.id]
        if n.type == "kelvin":
            arr = _apply_kelvin(arr, p.get("temperature", 0))
        elif n.type == "basic":
            arr = _apply_basic(arr, p)
        elif n.type == "curves":
            arr = _apply_curves(arr, p)
        elif n.type == "levels":
            arr = _apply_levels(arr, p)
    return np.clip(arr, 0.0, 1.0)


def render_widget_preview(
    image_bytes: bytes,
    mime_type: str,
    widget: Widget,
    max_dim: int = 256,
) -> str | None:
    """CPU approximation of the WebGL pipeline for thumbnail purposes.

    Returns a base64 JPEG, or None if any node uses an unsupported type
    (caller should fall back to no preview).
    """
    if any(n.type not in _SUPPORTED_NODE_TYPES for n in widget.nodes):
        return None

    arr = _apply_widget_nodes(_decode_downscaled(image_bytes, max_dim), widget)
    out = (arr * 255.0).astype(np.uint8)
    out_img = Image.fromarray(out, mode="RGB")
    buf = io.BytesIO()
    out_img.save(buf, format="JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def render_widget_effect_arrays(
    image_bytes: bytes,
    mime_type: str,
    widget: Widget,
    max_dim: int = 256,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Return (before, after) uint8 RGB arrays: the downscaled source and the
    same after the widget's ops. Used by suggestion self-verification to
    recompute the cheap pass on each. None if any node type is unsupported."""
    if any(n.type not in _SUPPORTED_NODE_TYPES for n in widget.nodes):
        return None
    before = _decode_downscaled(image_bytes, max_dim)
    after = _apply_widget_nodes(before.copy(), widget)
    return (
        (before * 255.0).astype(np.uint8),
        (after * 255.0).astype(np.uint8),
    )


def _apply_kelvin(arr: np.ndarray, temperature_offset: float) -> np.ndarray:
    # Linear approximation: positive offset warms (boost R, dampen B), negative cools.
    # Range maps from [-1200, 1200] to about [-0.15, +0.15] of channel shift.
    k = float(temperature_offset) / 1200.0 * 0.15
    arr = arr.copy()
    arr[:, :, 0] += k
    arr[:, :, 2] -= k
    return arr


def _apply_basic(arr: np.ndarray, params: dict) -> np.ndarray:
    # exposure (stops, [-2..2]) → linear gain
    exposure = float(params.get("exposure", 0.0))
    if exposure != 0.0:
        arr = arr * (2.0 ** exposure)
    # contrast ([-100..100]) → S-curve around 0.5 with strength scaled
    contrast = float(params.get("contrast", 0.0))
    if contrast != 0.0:
        amount = contrast / 100.0
        arr = (arr - 0.5) * (1.0 + amount) + 0.5
    # highlights / shadows / whites / blacks — linear mixes with anchored ranges.
    highlights = float(params.get("highlights", 0.0)) / 100.0
    shadows = float(params.get("shadows", 0.0)) / 100.0
    if highlights != 0.0:
        mask = np.clip((arr - 0.6) / 0.4, 0.0, 1.0)
        arr = arr + mask * highlights * 0.3
    if shadows != 0.0:
        mask = np.clip((0.4 - arr) / 0.4, 0.0, 1.0)
        arr = arr + mask * shadows * 0.3
    whites = float(params.get("whites", 0.0)) / 100.0
    if whites != 0.0:
        arr = arr + whites * 0.1
    blacks = float(params.get("blacks", 0.0)) / 100.0
    if blacks != 0.0:
        arr = arr - blacks * 0.1
    # saturation / vibrance — applied in HSV-ish space.
    saturation = float(params.get("saturation", 0.0)) / 100.0
    if saturation != 0.0:
        grey = arr.mean(axis=2, keepdims=True)
        arr = grey + (arr - grey) * (1.0 + saturation)
    return arr


def _apply_curves(arr: np.ndarray, params: dict) -> np.ndarray:
    points = params.get("points")
    if not isinstance(points, list) or len(points) < 2:
        return arr
    pts = [
        (float(p[0]), float(p[1]))
        for p in points
        if isinstance(p, (list, tuple)) and len(p) == 2
    ]
    pts.sort()
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts])
    # Linear interpolation; clamped at endpoints.
    luma = arr.mean(axis=2)
    new_luma = np.interp(luma, xs, ys)
    ratio = np.where(luma > 1e-6, new_luma / np.maximum(luma, 1e-6), 1.0)
    return arr * ratio[..., None]


def _apply_levels(arr: np.ndarray, params: dict) -> np.ndarray:
    black = float(params.get("black", 0.0)) / 255.0
    white = float(params.get("white", 255.0)) / 255.0
    gamma = float(params.get("gamma", 1.0))
    if white <= black:
        return arr
    arr = np.clip((arr - black) / max(1e-6, white - black), 0.0, 1.0)
    if gamma != 1.0:
        arr = arr ** (1.0 / max(1e-3, gamma))
    return arr
