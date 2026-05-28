from __future__ import annotations

from threading import Lock
from typing import TYPE_CHECKING

import numpy as np

try:
    import torch
    from sam2.sam2_image_predictor import SAM2ImagePredictor
except ImportError:  # pragma: no cover — missing in dev envs without sam2 installed
    torch = None  # type: ignore[assignment]
    SAM2ImagePredictor = None  # type: ignore[assignment,misc]

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
    """Wraps Meta's SAM 2.1 image predictor.

    Singleton lifetime — model load is expensive. Single-active-session
    embedding cache: calling embed() with a new session_id invalidates the
    previous embedding.

    SAM 2.1 was chosen over SAM 3 because SAM 3 has CUDA-only hardcodes that
    prevent it from running on Apple Silicon. The SAM 3 integration is
    preserved in `sam_client_sam3.py.future` for re-introduction when the
    backend moves to a Linux+CUDA host.
    """

    def __init__(self, settings: "Settings") -> None:
        device = _pick_device()
        predictor = SAM2ImagePredictor.from_pretrained(
            settings.sam_model_name,
            device=device,
        )
        self._predictor = predictor
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
        return masks[best].astype(bool)

    def decode_box(self, session_id: str, box: np.ndarray) -> np.ndarray:
        """Returns a single 2D bool mask for a box prompt."""
        with self._lock:
            self._ensure_embedded(session_id)
            masks, scores, _ = self._predictor.predict(
                box=box,
                multimask_output=True,
            )
        best = int(np.argmax(scores))
        return masks[best].astype(bool)

    def decode_box_for_region(
        self,
        session_id: str,
        bbox: tuple[float, float, float, float] | list[float],
        label: str,
    ) -> tuple[np.ndarray, str]:
        """Decode a SAM mask for a Claude-named region. Returns (mask_array, mask_id).

        The mask is registered with the region label so the frontend can resolve
        `scope.named_region` → mask. Re-raises any backend error so the caller
        can decide whether to skip or fail the whole pipeline.
        """
        from app.api import deps as _deps
        mask = self.decode_box(session_id, np.array(bbox, dtype=np.float32))
        mask_id = _deps.get_session_store().register_mask(
            session_id, mask, label=label, source="ai-proposed",
        )
        return mask, mask_id

    def decode_combined(
        self,
        session_id: str,
        points: np.ndarray | None = None,
        labels: np.ndarray | None = None,
        box: np.ndarray | None = None,
    ) -> np.ndarray:
        """Predict a single mask using any combination of points + box.

        Used by the two-pass refinement flow where Claude returns richer prompts
        (e.g. a bbox + several positive clicks + negative clicks excluding
        adjacent objects). `multimask_output=False` because SAM returns a single
        best mask when given multiple disambiguating prompts.
        """
        if (points is None) != (labels is None):
            raise ValueError("points and labels must be provided together")
        if points is None and box is None:
            raise ValueError("at least one of points or box must be provided")
        with self._lock:
            self._ensure_embedded(session_id)
            masks, _, _ = self._predictor.predict(
                point_coords=points,
                point_labels=labels,
                box=box,
                multimask_output=False,
            )
        return masks[0].astype(bool)
