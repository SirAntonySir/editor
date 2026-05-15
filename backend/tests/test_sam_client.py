from __future__ import annotations

import numpy as np
import pytest
from unittest.mock import MagicMock, patch

from app.services.sam_client import SamClient


def _fake_settings(model="vit_b", path="/fake/path"):
    s = MagicMock()
    s.sam_model_name = model
    s.sam_checkpoint_path = path
    return s


@pytest.fixture
def patched_sam():
    """Patches the sam_model_registry + SamPredictor to skip real model load."""
    with patch("app.services.sam_client.sam_model_registry") as registry, \
         patch("app.services.sam_client.SamPredictor") as predictor_cls:
        registry.__getitem__.return_value.return_value = MagicMock()
        predictor = MagicMock()
        predictor_cls.return_value = predictor
        yield predictor


def _make_dummy_image() -> np.ndarray:
    return np.zeros((100, 100, 3), dtype=np.uint8)


class TestSamClient:
    def test_embed_caches_per_session(self, patched_sam):
        client = SamClient(_fake_settings())
        img = _make_dummy_image()
        client.embed("session-A", img)
        client.embed("session-A", img)
        assert patched_sam.set_image.call_count == 1

    def test_embed_invalidates_when_session_changes(self, patched_sam):
        client = SamClient(_fake_settings())
        img = _make_dummy_image()
        client.embed("session-A", img)
        client.embed("session-B", img)
        assert patched_sam.set_image.call_count == 2

    def test_decode_point_returns_best_mask(self, patched_sam):
        client = SamClient(_fake_settings())
        m0 = np.zeros((50, 50), dtype=bool)
        m1 = np.ones((50, 50), dtype=bool)
        m2 = np.zeros((50, 50), dtype=bool)
        patched_sam.predict.return_value = (
            np.stack([m0, m1, m2]),
            np.array([0.1, 0.9, 0.5]),
            None,
        )
        client.embed("s", _make_dummy_image())
        out = client.decode_point(
            "s",
            points=np.array([[10.0, 20.0]], dtype=np.float32),
            labels=np.array([1], dtype=np.float32),
        )
        assert out.shape == (50, 50)
        assert out.all()

    def test_decode_box_uses_box_predict(self, patched_sam):
        client = SamClient(_fake_settings())
        mask = np.ones((50, 50), dtype=bool)
        patched_sam.predict.return_value = (
            np.stack([mask]),
            np.array([0.95]),
            None,
        )
        client.embed("s", _make_dummy_image())
        out = client.decode_box(
            "s", box=np.array([0.0, 0.0, 50.0, 50.0], dtype=np.float32),
        )
        kwargs = patched_sam.predict.call_args.kwargs
        assert "box" in kwargs
        assert out.shape == (50, 50)

    def test_decode_requires_prior_embed(self, patched_sam):
        client = SamClient(_fake_settings())
        with pytest.raises(RuntimeError, match="not embedded"):
            client.decode_point(
                "session-never-embedded",
                points=np.array([[1.0, 1.0]], dtype=np.float32),
                labels=np.array([1], dtype=np.float32),
            )
