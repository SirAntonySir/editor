"""Shared fakes for pipeline contract tests.

These tests verify the observable wire shape across the analyze pipeline.
They MUST NOT call Anthropic, MUST NOT load SAM weights, and MUST be
deterministic. Every external dependency is monkey-patched here.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.schemas.image_context import CandidateRegion, ImageContext
# Internal type at backend/app/services/anthropic_client.py:201.
from app.services.anthropic_client import _ContextSoftFields


_CANNED_CONTEXT = ImageContext(
    subjects=["a person"],
    lighting="flat",
    dominant_tones=["midtones"],
    mood="neutral test",
    candidate_regions=[
        CandidateRegion(
            label="person",
            description="The subject.",
            bbox=[0.1, 0.1, 0.6, 0.8],
            representative_point=[0.4, 0.5],
        ),
        CandidateRegion(
            label="background",
            description="Behind the subject.",
            bbox=[0.0, 0.0, 1.0, 1.0],
            representative_point=[0.05, 0.05],
        ),
    ],
    model_name="claude-haiku-4-5-test",
    model_version="test",
    generated_at="2026-06-11T00:00:00Z",
)


@pytest.fixture
def fake_anthropic(monkeypatch):
    """Replace every Claude call used by the analyze pipeline with a canned
    return that matches the production response shape."""
    from app.services import anthropic_client

    def _analyze(*_args, **_kwargs):
        return _CANNED_CONTEXT.model_copy(deep=True)

    def _augment(*_args, **_kwargs):
        return _ContextSoftFields(
            estimated_white_point=(0.5, 0.5, 0.5),
            wb_neutral_confidence=0.8,
            grade_character="neutral",
            problems=[],
            region_soft_fields=[],
        )

    def _suggest(*_args, **_kwargs):
        return []  # no autonomous suggestions in tests

    monkeypatch.setattr(anthropic_client.AnthropicClient, "analyze_image", _analyze)
    monkeypatch.setattr(
        anthropic_client.AnthropicClient, "augment_context_soft_fields", _augment,
    )
    monkeypatch.setattr(
        anthropic_client.AnthropicClient,
        "suggest_fused_tools_for_character",
        _suggest,
    )


@pytest.fixture
def fake_sam(monkeypatch):
    """Replace the SAM client with a deterministic dummy that returns a
    centered rectangular mask for any bbox prompt. Keeps tests off the
    GPU and reproducible across runs."""

    class _DummySam:
        def embed(self, _sid, _arr):
            return None

        def decode_box(self, _sid, pixel_bbox):
            x1, y1, x2, y2 = pixel_bbox.astype(int)
            h = max(int(y2) + 1, 4)
            w = max(int(x2) + 1, 4)
            mask = np.zeros((h, w), dtype=bool)
            mask[y1:y2, x1:x2] = True
            return mask

    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _DummySam())
