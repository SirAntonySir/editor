from __future__ import annotations

from threading import Lock
from typing import TYPE_CHECKING

import numpy as np

try:
    import torch
    from segment_anything import SamPredictor, sam_model_registry
except ImportError:  # pragma: no cover — missing in dev without GPU env
    torch = None  # type: ignore[assignment]
    SamPredictor = None  # type: ignore[assignment,misc]
    sam_model_registry = None  # type: ignore[assignment]

if TYPE_CHECKING:
    from app.config import Settings


def _pick_device() -> str:
    if torch is None:
        return "cpu"
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class SamClient:
    """Wraps Meta's segment-anything predictor.

    Singleton lifetime — model load is expensive. Single-active-session
    embedding cache: calling embed() with a new session_id invalidates the
    previous embedding.
    """

    def __init__(self, settings: "Settings") -> None:
        device = _pick_device()
        sam = sam_model_registry[settings.sam_model_name](
            checkpoint=settings.sam_checkpoint_path,
        )
        sam.to(device)
        self._predictor = SamPredictor(sam)
        self._embedded_session: str | None = None
        self._lock = Lock()
        self.device = device
        self.model_name = settings.sam_model_name

    def embed(self, session_id: str, image_rgb: np.ndarray) -> None:
        """Encode image. Cached per session_id. Idempotent."""
        with self._lock:
            if self._embedded_session == session_id:
                return
            self._predictor.set_image(image_rgb)
            self._embedded_session = session_id

    def _ensure_embedded(self, session_id: str) -> None:
        if self._embedded_session != session_id:
            raise RuntimeError(
                f"session {session_id!r} is not embedded; call embed() first",
            )

    def decode_point(
        self,
        session_id: str,
        points: np.ndarray,
        labels: np.ndarray,
    ) -> np.ndarray:
        """Returns a single 2D bool mask at the image's resolution."""
        with self._lock:
            self._ensure_embedded(session_id)
            masks, scores, _ = self._predictor.predict(
                point_coords=points,
                point_labels=labels,
                multimask_output=True,
            )
        best = int(np.argmax(scores))
        return masks[best]

    def decode_box(self, session_id: str, box: np.ndarray) -> np.ndarray:
        """Returns a single 2D bool mask for a box prompt."""
        with self._lock:
            self._ensure_embedded(session_id)
            masks, scores, _ = self._predictor.predict(
                box=box,
                multimask_output=True,
            )
        best = int(np.argmax(scores))
        return masks[best]
