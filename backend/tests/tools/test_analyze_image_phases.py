import pytest
from io import BytesIO
from PIL import Image
from unittest.mock import patch, MagicMock
from app.tools.atomic.analyze_image import AnalyzeImageTool as AnalyzeImage
from app.state.document import SessionDocument
from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.image_context import ImageContext, CandidateRegion


def _make_png() -> bytes:
    buf = BytesIO()
    Image.new("RGB", (8, 8), (100, 100, 100)).save(buf, format="PNG")
    return buf.getvalue()


PNG_MIN = _make_png()


def _fake_base_ctx() -> ImageContext:
    return ImageContext(
        subjects=["test"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="neutral",
        candidate_regions=[
            CandidateRegion(
                label="sky", description="upper region",
                bbox=[0.0, 0.0, 1.0, 0.5],
                representative_point=[0.5, 0.25],
            ),
            CandidateRegion(
                label="ground", description="lower region",
                bbox=[0.0, 0.5, 1.0, 1.0],
                representative_point=[0.5, 0.75],
            ),
        ],
        model_name="test", model_version="1.0", generated_at="2026-05-28T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_phase_events_emitted_in_order():
    doc = SessionDocument(session_id="s1", image_bytes=PNG_MIN, mime_type="image/png")
    captured: list[str] = []
    orig_emit = doc._emit
    def _capture(kind, payload):
        captured.append(kind)
        return orig_emit(kind, payload)
    doc._emit = _capture  # type: ignore[method-assign]

    with patch("app.tools.atomic.analyze_image.deps") as mock_deps:
        mock_client = MagicMock()
        mock_client.analyze_image.return_value = _fake_base_ctx()
        mock_client.augment_context_soft_fields.return_value = MagicMock(
            estimated_white_point=(255, 255, 255),
            wb_neutral_confidence=0.5,
            grade_character="neutral",
            problems=[],
            region_soft_fields=[],
        )
        mock_client.suggest_fused_tools_for_character.return_value = []
        mock_sam = MagicMock()
        mock_sam.embed.return_value = None
        import numpy as np
        mock_sam.decode_box.return_value = np.zeros((10, 10), dtype="uint8")
        mock_deps.get_anthropic_client.return_value = mock_client
        mock_deps.get_sam_client.return_value = mock_sam
        mock_deps.get_session_store.return_value.set_context = MagicMock()
        await AnalyzeImage().handler(doc, AnalyzeImage.input_schema())

    phase_events = [k for k in captured if k.startswith("phase.")]
    assert "phase.started" in phase_events
    assert "phase.completed" in phase_events
    started_count = sum(1 for k in phase_events if k == "phase.started")
    completed_count = sum(1 for k in phase_events if k == "phase.completed")
    assert started_count == 5
    assert completed_count == 5


@pytest.mark.asyncio
async def test_sam_embed_failure_degrades_gracefully():
    doc = SessionDocument(session_id="s2", image_bytes=PNG_MIN, mime_type="image/png")
    with patch("app.tools.atomic.analyze_image.deps") as mock_deps:
        mock_client = MagicMock()
        mock_client.analyze_image.return_value = _fake_base_ctx()
        mock_client.augment_context_soft_fields.return_value = MagicMock(
            estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.5,
            grade_character="neutral", problems=[], region_soft_fields=[],
        )
        mock_client.suggest_fused_tools_for_character.return_value = []
        mock_sam = MagicMock()
        mock_sam.embed.side_effect = RuntimeError("SAM down")
        mock_deps.get_anthropic_client.return_value = mock_client
        mock_deps.get_sam_client.return_value = mock_sam
        mock_deps.get_session_store.return_value.set_context = MagicMock()
        result = await AnalyzeImage().handler(doc, AnalyzeImage.input_schema())
        assert isinstance(result, EnrichedImageContext)
