# Plan 2 — Fused Tools + Enriched Image Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1 (MCP Foundations) is complete and merged. This plan extends `analyze_image`, adds the `FusedToolTemplate` framework, ships 9 starter fused tools, and registers the widget-lifecycle tools (`propose_widget`, `refine_widget`, `repeat_widget`, `delete_widget`, `restore_widget`, `accept_widget`, `set_widget_param`, `list_fused_tools`).

**Goal:** External Claude (and the existing in-app AI panel via REST) can call `propose_widget(intent, scope, fused_tool_id?)` and receive a composite widget whose structure is fixed in Python and whose numbers are tuned per-image by Claude inside a `param_envelope`. Per-widget refine / repeat / delete / restore / accept all work end-to-end.

**Architecture:** Each fused tool is a Python module declaring (a) a node-graph skeleton, (b) ordered bindings, (c) parameter envelope, (d) declarative context inputs, and (e) an async `resolve()` that issues a structured Claude tool_use call. A `run_fused_tool()` wrapper enforces envelope clamping, retries with the clamp note in the prompt, and seeds from envelope midpoints on triple-miss. Autonomous-suggestion pass inside `analyze_image` mints `mcp_autonomous` widgets from `EnrichedImageContext.problems[]`.

**Tech Stack:** numpy + Pillow + OpenCV for cheap-pass stats, the existing `AnthropicClient` (extended with `resolve_fused_tool` and `name_pick_fused_tool`), Pydantic schema validation on every Claude response.

---

## File Structure

**New files:**
- `backend/app/schemas/enriched_context.py` — `EnrichedImageContext` extending v1 `ImageContext`, `Problem`, `RegionStats`, `ColorSwatch`.
- `backend/app/state/context_stats.py` — pure-numpy cheap-pass computation.
- `backend/app/tools/fused_framework.py` — `FusedToolTemplate`, `NodeSkeleton`, `BindingSkeleton`, `ParamRange`, `ResolvedNumbers`, `run_fused_tool` orchestrator + clamp + seed helpers.
- `backend/app/tools/fused/__init__.py` — discovers and registers all fused tools at startup.
- `backend/app/tools/fused/<id>.py` for each starter tool: `warm_grade`, `cool_grade`, `exposure_balance`, `sky_recovery`, `portrait_glow`, `bw_cinematic`, `cast_correct`, `teal_orange`, `subject_pop`.
- `backend/app/tools/widgets/__init__.py`
- `backend/app/tools/widgets/propose_widget.py`, `refine_widget.py`, `repeat_widget.py`, `delete_widget.py`, `restore_widget.py`, `accept_widget.py`, `set_widget_param.py`
- `backend/app/tools/atomic/list_fused_tools.py`
- Test files mirroring each new module under `backend/tests/`.

**Modified files:**
- `backend/app/schemas/image_context.py` — re-export `EnrichedImageContext` from `enriched_context.py` for compatibility.
- `backend/app/services/anthropic_client.py` — add `resolve_fused_tool(template, prompt_payload, session_id) → ResolvedNumbers` and `name_pick_fused_tool(intent, candidates, session_id) → str | None`.
- `backend/app/tools/atomic/analyze_image.py` — compute cheap-pass stats, optionally call Claude for the soft fields, and run the autonomous-suggestion pass.
- `backend/app/tools/atomic/__init__.py` — register `list_fused_tools`.
- `backend/app/tools/registry.py` — add envelope-violation, fused-tool-not-found, skin-safety-violation, llm-validation-failed mappings.

**Untouched:** Plan 1's atomic / selection tools; `/api/panel` and `/api/refine` shims; the frontend.

---

## Conventions reused from Plan 1

- TDD pattern, `pytest backend/tests/<path> -v`, Conventional Commits, `Co-Authored-By` trailer.
- Fake `AnthropicClient` is monkeypatched onto `app.api.deps._anthropic_client`. New tests follow the same pattern as Plan 1's `analyze_image` test.

---

## Task 1: EnrichedImageContext schema

**Files:**
- Create: `backend/app/schemas/enriched_context.py`
- Modify: `backend/app/schemas/image_context.py` (re-export)
- Test: `backend/tests/schemas/test_enriched_context.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/schemas/test_enriched_context.py
import pytest
from pydantic import ValidationError

from app.schemas.enriched_context import (
    ColorSwatch,
    EnrichedImageContext,
    Problem,
    RegionStats,
)


def test_color_swatch_rgb_and_weight() -> None:
    s = ColorSwatch(rgb=(255, 100, 50), weight=0.4)
    assert s.weight == 0.4


def test_problem_required_fields() -> None:
    p = Problem(
        kind="clipped_highlights", severity=0.7, region_label=None, bbox=None,
        suggested_fused_tools=["sky_recovery"],
    )
    assert p.kind == "clipped_highlights"


def test_problem_kind_rejects_unknown() -> None:
    with pytest.raises(ValidationError):
        Problem(kind="brokenz", severity=0.5, suggested_fused_tools=[])


def test_region_stats_round_trip() -> None:
    rs = RegionStats(
        label="sky", pixel_count=1000,
        mean_luma=200.0,
        luma_histogram=[0] * 32,
        mean_rgb=(150.0, 180.0, 220.0),
        dominant_swatches=[ColorSwatch(rgb=(150, 180, 220), weight=1.0)],
        is_skin_likely=False, is_sky_likely=True,
        saturation_mean=0.4, contrast_p10_p90=80.0,
    )
    assert RegionStats.model_validate(rs.model_dump()) == rs


def test_enriched_image_context_extends_v1(sample_image_context) -> None:
    enriched = {
        **sample_image_context,
        "luma_histogram": [0] * 256,
        "rgb_histograms": {"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        "clipped_shadows_pct": 0.0,
        "clipped_highlights_pct": 0.0,
        "median_luma": 128.0,
        "contrast_p10_p90": 100.0,
        "color_palette": [],
        "cast_strength": 0.0,
        "cast_direction": (0.0, 0.0),
        "region_stats": [],
        "estimated_white_point": (255.0, 255.0, 255.0),
        "wb_neutral_confidence": 0.5,
        "grade_character": "neutral",
        "problems": [],
    }
    ctx = EnrichedImageContext.model_validate(enriched)
    assert ctx.subjects == sample_image_context["subjects"]
    assert ctx.grade_character == "neutral"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/schemas/test_enriched_context.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/schemas/enriched_context.py
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.image_context import ImageContext


class ColorSwatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rgb: tuple[int, int, int]
    weight: float = Field(ge=0.0, le=1.0)


ProblemKind = Literal[
    "clipped_highlights", "crushed_shadows", "low_contrast",
    "strong_color_cast", "noisy_shadows", "uneven_white_balance",
]


class Problem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ProblemKind
    severity: float = Field(ge=0.0, le=1.0)
    region_label: str | None = None
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    suggested_fused_tools: list[str] = Field(default_factory=list)


class RegionStats(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    pixel_count: int = Field(ge=0)
    mean_luma: float
    luma_histogram: list[int] = Field(default_factory=lambda: [0] * 32, min_length=32, max_length=32)
    mean_rgb: tuple[float, float, float]
    dominant_swatches: list[ColorSwatch] = Field(default_factory=list)
    is_skin_likely: bool
    is_sky_likely: bool
    saturation_mean: float = Field(ge=0.0, le=1.0)
    contrast_p10_p90: float


class EnrichedImageContext(ImageContext):
    """Additive extension of v1 ImageContext.

    Cheap pass fills the numeric fields locally; the Claude-augmented pass
    fills `estimated_white_point`, `wb_neutral_confidence`, `grade_character`,
    `problems`, plus per-region `is_skin_likely` / `is_sky_likely`."""

    # Cheap pass
    luma_histogram: list[int] = Field(default_factory=lambda: [0] * 256, min_length=256, max_length=256)
    rgb_histograms: dict[str, list[int]] = Field(default_factory=dict)
    clipped_shadows_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    clipped_highlights_pct: float = Field(default=0.0, ge=0.0, le=100.0)
    median_luma: float = 0.0
    contrast_p10_p90: float = 0.0
    color_palette: list[ColorSwatch] = Field(default_factory=list)
    cast_strength: float = Field(default=0.0, ge=0.0, le=1.0)
    cast_direction: tuple[float, float] = (0.0, 0.0)
    region_stats: list[RegionStats] = Field(default_factory=list)

    # Claude-augmented pass
    estimated_white_point: tuple[float, float, float] = (255.0, 255.0, 255.0)
    wb_neutral_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    grade_character: str = "neutral"
    problems: list[Problem] = Field(default_factory=list)
```

Append to `backend/app/schemas/image_context.py`:

```python
from .enriched_context import EnrichedImageContext  # noqa: F401
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/schemas/test_enriched_context.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/enriched_context.py backend/app/schemas/image_context.py backend/tests/schemas/test_enriched_context.py
git commit -m "$(cat <<'EOF'
feat(schemas): EnrichedImageContext v2 with cheap + soft fields

ImageContext extended with histograms, palette, region stats, cast info,
WB neutral, grade character, and detected problems. Cheap fields default
to neutral values so v1 contexts still validate; the analyze pipeline
populates them in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Cheap-pass statistics computation

**Files:**
- Create: `backend/app/state/context_stats.py`
- Test: `backend/tests/state/test_context_stats.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/state/test_context_stats.py
import numpy as np

from app.state.context_stats import compute_cheap_pass


def test_uniform_grey_image_has_centered_histograms() -> None:
    img = np.full((64, 64, 3), 128, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert sum(s.luma_histogram) == 64 * 64
    assert s.luma_histogram[128] == 64 * 64
    assert s.clipped_shadows_pct == 0.0
    assert s.clipped_highlights_pct == 0.0
    assert s.median_luma == 128.0


def test_white_image_clipped_highlights() -> None:
    img = np.full((32, 32, 3), 255, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert s.clipped_highlights_pct == 100.0
    assert s.median_luma == 255.0


def test_black_image_clipped_shadows() -> None:
    img = np.zeros((32, 32, 3), dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert s.clipped_shadows_pct == 100.0
    assert s.median_luma == 0.0


def test_color_palette_has_at_most_8_swatches() -> None:
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, size=(64, 64, 3), dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert 1 <= len(s.color_palette) <= 8


def test_cast_direction_has_two_floats() -> None:
    img = np.full((16, 16, 3), 128, dtype=np.uint8)
    s = compute_cheap_pass(img)
    assert len(s.cast_direction) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/state/test_context_stats.py -v`
Expected: ImportError on `app.state.context_stats`.

- [ ] **Step 3: Implement**

```python
# backend/app/state/context_stats.py
from __future__ import annotations

import cv2
import numpy as np
from pydantic import BaseModel, Field

from app.schemas.enriched_context import ColorSwatch


class CheapPassResult(BaseModel):
    """Local-only stats. Filled into EnrichedImageContext by analyze_image."""

    luma_histogram: list[int]
    rgb_histograms: dict[str, list[int]]
    clipped_shadows_pct: float
    clipped_highlights_pct: float
    median_luma: float
    contrast_p10_p90: float
    color_palette: list[ColorSwatch] = Field(default_factory=list)
    cast_strength: float
    cast_direction: tuple[float, float]


def compute_cheap_pass(image_rgb: np.ndarray) -> CheapPassResult:
    """Pure numpy/cv2 path; no Claude. Image is HxWx3 uint8 RGB."""
    assert image_rgb.dtype == np.uint8 and image_rgb.shape[-1] == 3

    # ITU-R BT.601 luma weights.
    luma = (
        0.299 * image_rgb[:, :, 0] + 0.587 * image_rgb[:, :, 1] + 0.114 * image_rgb[:, :, 2]
    ).astype(np.uint8)
    luma_hist, _ = np.histogram(luma, bins=256, range=(0, 256))
    total = luma.size

    clipped_shadows_pct = float((luma <= 4).sum()) / total * 100.0
    clipped_highlights_pct = float((luma >= 251).sum()) / total * 100.0
    median_luma = float(np.median(luma))
    p10 = float(np.percentile(luma, 10))
    p90 = float(np.percentile(luma, 90))
    contrast = p90 - p10

    rgb_hists: dict[str, list[int]] = {}
    for i, ch in enumerate("rgb"):
        h, _ = np.histogram(image_rgb[:, :, i], bins=256, range=(0, 256))
        rgb_hists[ch] = h.astype(int).tolist()

    palette = _palette(image_rgb)

    # Cast: compare mean R, G, B against equal-luma neutral. Direction in Lab a*/b*.
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)
    a_mean = float(lab[:, :, 1].mean()) - 128.0
    b_mean = float(lab[:, :, 2].mean()) - 128.0
    cast_strength = float(min(1.0, (a_mean**2 + b_mean**2) ** 0.5 / 60.0))

    return CheapPassResult(
        luma_histogram=luma_hist.astype(int).tolist(),
        rgb_histograms=rgb_hists,
        clipped_shadows_pct=clipped_shadows_pct,
        clipped_highlights_pct=clipped_highlights_pct,
        median_luma=median_luma,
        contrast_p10_p90=contrast,
        color_palette=palette,
        cast_strength=cast_strength,
        cast_direction=(a_mean, b_mean),
    )


def _palette(image_rgb: np.ndarray, k: int = 8) -> list[ColorSwatch]:
    """Cheap k-means palette. Downsample for speed."""
    h, w = image_rgb.shape[:2]
    scale = max(1, int(max(h, w) / 256))
    small = image_rgb[::scale, ::scale]
    pixels = small.reshape(-1, 3).astype(np.float32)
    n = pixels.shape[0]
    if n < k:
        k = max(1, n)
    # cv2 kmeans returns labels + centres
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5)
    _, labels, centres = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k).astype(np.float64)
    weights = counts / counts.sum()
    palette: list[ColorSwatch] = []
    for centre, weight in zip(centres, weights):
        palette.append(ColorSwatch(
            rgb=(int(centre[0]), int(centre[1]), int(centre[2])),
            weight=float(weight),
        ))
    palette.sort(key=lambda s: s.weight, reverse=True)
    return palette
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/state/test_context_stats.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/context_stats.py backend/tests/state/test_context_stats.py
git commit -m "$(cat <<'EOF'
feat(state): cheap-pass stats — histograms, palette, clipping, cast

Pure numpy/cv2 computation. Returns the dense numeric block of an
EnrichedImageContext. Soft fields (problems, grade_character, WB neutral,
per-region skin/sky) are added by a separate Claude pass in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `AnthropicClient` with the soft-context pass

**Files:**
- Modify: `backend/app/services/anthropic_client.py`
- Test: extend `backend/tests/test_anthropic_client.py`

- [ ] **Step 1: Write the failing test**

```python
# Append to backend/tests/test_anthropic_client.py
from app.schemas.enriched_context import EnrichedImageContext


def test_augment_context_returns_typed_fields(monkeypatch) -> None:
    from app.services.anthropic_client import AnthropicClient
    from app.schemas.enriched_context import Problem

    class _FakeResponse:
        usage = type("U", (), {"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "input_tokens": 0})()
        content = [type("Block", (), {
            "type": "tool_use",
            "name": "emit_context_soft_fields",
            "input": {
                "estimated_white_point": [255, 255, 255],
                "wb_neutral_confidence": 0.8,
                "grade_character": "warm-amber",
                "problems": [{
                    "kind": "clipped_highlights", "severity": 0.7,
                    "region_label": None, "bbox": None,
                    "suggested_fused_tools": ["sky_recovery"],
                }],
                "region_soft_fields": [],
            },
        })()]

    class _FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                return _FakeResponse()

    client = AnthropicClient(api_key="x", model="claude-opus-4-7")
    monkeypatch.setattr(client, "_client", _FakeClient())
    result = client.augment_context_soft_fields(
        image_bytes=b"x",
        mime_type="image/jpeg",
        base_context_json={
            "subjects": [], "lighting": "flat", "dominant_tones": [], "mood": "calm",
            "candidate_regions": [],
            "model_name": "x", "model_version": "y", "generated_at": "2026-05-21T00:00:00Z",
        },
        cheap_pass_summary={"median_luma": 128.0, "cast_strength": 0.1},
        session_id="s",
    )
    assert result.grade_character == "warm-amber"
    assert isinstance(result.problems[0], Problem)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_anthropic_client.py::test_augment_context_returns_typed_fields -v`
Expected: AttributeError — `augment_context_soft_fields` doesn't exist.

- [ ] **Step 3: Implement**

In `backend/app/services/anthropic_client.py`, add after the existing class members:

```python
from app.schemas.enriched_context import EnrichedImageContext, Problem


class _ContextSoftFields(BaseModel):
    estimated_white_point: tuple[float, float, float]
    wb_neutral_confidence: float
    grade_character: str
    problems: list[Problem]
    region_soft_fields: list[dict]  # per-region {label, is_skin_likely, is_sky_likely}


_SOFT_FIELDS_TOOL = {
    "name": "emit_context_soft_fields",
    "description": "Emit the soft fields completing the EnrichedImageContext.",
    "input_schema": _ContextSoftFields.model_json_schema(),
}


_AUGMENT_PROMPT = """You are completing an EnrichedImageContext for a photo editor. \
You see ONE image and a JSON summary of cheap statistics (histograms, median luma, cast). \
Fill in: estimated_white_point (RGB of the most likely neutral pixels), \
wb_neutral_confidence (0..1; low if no clearly-neutral region exists), \
grade_character (short label: warm-amber / cool-cinematic / neutral / teal-orange / ...), \
problems[] (one entry per detected issue with severity 0..1 and suggested_fused_tools), \
and region_soft_fields[] (per candidate region label, is_skin_likely + is_sky_likely). \
\
Suggested fused tool ids are: warm_grade, cool_grade, exposure_balance, sky_recovery, \
portrait_glow, bw_cinematic, cast_correct, teal_orange, subject_pop. \
\
Call the `emit_context_soft_fields` tool exactly once. Do not return prose."""


class AnthropicClient:
    # ...existing methods unchanged...

    def augment_context_soft_fields(
        self,
        image_bytes: bytes,
        mime_type: str,
        base_context_json: dict,
        cheap_pass_summary: dict,
        session_id: str | None = None,
    ) -> _ContextSoftFields:
        for attempt in range(3):
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1500,
                system=[{"type": "text", "text": _AUGMENT_PROMPT, "cache_control": {"type": "ephemeral"}}],
                tools=[_SOFT_FIELDS_TOOL],
                tool_choice={"type": "tool", "name": "emit_context_soft_fields"},
                messages=[
                    {
                        "role": "user",
                        "content": [
                            self._image_block(image_bytes, mime_type),
                            {"type": "text", "text": f"Cheap-pass summary: {cheap_pass_summary}"},
                            {"type": "text", "text": f"Base context: {base_context_json}"},
                        ],
                    }
                ],
            )
            _log_cache_stats("augment_context", session_id, response)
            for block in response.content:
                if getattr(block, "type", None) == "tool_use" and block.name == "emit_context_soft_fields":
                    try:
                        return _ContextSoftFields.model_validate(block.input)
                    except ValidationError as e:
                        logger.warning("augment_context validation failed (attempt %d): %s", attempt, e)
                        last_error = e
                        break
        raise RuntimeError(f"augment_context_soft_fields failed: {last_error}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_anthropic_client.py::test_augment_context_returns_typed_fields -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/tests/test_anthropic_client.py
git commit -m "$(cat <<'EOF'
feat(anthropic): augment_context_soft_fields — Claude pass for soft fields

One additional structured-output call that completes the
EnrichedImageContext (WB neutral, grade character, problems, per-region
skin/sky flags) from the image + cheap-pass summary.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire enriched analysis into `analyze_image`

**Files:**
- Modify: `backend/app/tools/atomic/analyze_image.py`
- Test: extend `backend/tests/tools/test_analyze_image.py`

- [ ] **Step 1: Write the failing test**

```python
# Append to backend/tests/tools/test_analyze_image.py
def test_analyze_image_fills_cheap_pass_and_soft_fields(client) -> None:
    from app.api import deps
    from app.schemas.enriched_context import EnrichedImageContext
    from io import BytesIO
    from PIL import Image

    # The earlier _FakeClaude in this file's analyze_image fixture returns a
    # plain ImageContext. Wrap it with a soft-field returner.
    class _FakeClaudeFull(_FakeClaude):  # type: ignore[name-defined]
        def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
            from app.services.anthropic_client import _ContextSoftFields
            from app.schemas.enriched_context import Problem
            return _ContextSoftFields(
                estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.5,
                grade_character="neutral",
                problems=[Problem(kind="low_contrast", severity=0.6, suggested_fused_tools=["exposure_balance"])],
                region_soft_fields=[],
            )

    deps._anthropic_client = _FakeClaudeFull()

    buf = BytesIO()
    Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ctx = body["output"]
    assert ctx["grade_character"] == "neutral"
    assert ctx["clipped_shadows_pct"] == 0.0
    assert any(p["kind"] == "low_contrast" for p in ctx["problems"])
    doc = deps.get_session_store().get_document(sid)
    assert isinstance(doc.image_context, EnrichedImageContext)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_analyze_image.py -v`
Expected: assertion failures — the fields are missing.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/atomic/analyze_image.py — replace handler
from __future__ import annotations

import io

import numpy as np
from PIL import Image
from pydantic import BaseModel

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext, RegionStats
from app.state.context_stats import compute_cheap_pass
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(EnrichedImageContext):
    pass


class AnalyzeImageTool(BackendTool[_Input, _Output]):
    name = "analyze_image"
    kind = "mutate"
    description = (
        "Run image analysis (cached). Returns the EnrichedImageContext including "
        "cheap-pass statistics and Claude-augmented soft fields."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if isinstance(doc.image_context, EnrichedImageContext):
            return _Output.model_validate(doc.image_context.model_dump(mode="json"))

        client = deps.get_anthropic_client()
        # 1. Base analysis (existing AnthropicClient call).
        base_ctx = client.analyze_image(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            session_id=doc.session_id,
        )

        # 2. Cheap-pass stats.
        img = Image.open(io.BytesIO(doc.image_bytes)).convert("RGB")
        arr = np.array(img)
        cheap = compute_cheap_pass(arr)

        # 3. Claude-augmented soft fields.
        soft = client.augment_context_soft_fields(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            base_context_json=base_ctx.model_dump(mode="json"),
            cheap_pass_summary={
                "median_luma": cheap.median_luma,
                "clipped_shadows_pct": cheap.clipped_shadows_pct,
                "clipped_highlights_pct": cheap.clipped_highlights_pct,
                "contrast_p10_p90": cheap.contrast_p10_p90,
                "cast_strength": cheap.cast_strength,
                "cast_direction": list(cheap.cast_direction),
            },
            session_id=doc.session_id,
        )

        # 4. Per-region stats (cheap, deterministic).
        region_stats = _compute_region_stats(arr, base_ctx, soft.region_soft_fields)

        ctx = EnrichedImageContext(
            **base_ctx.model_dump(),
            luma_histogram=cheap.luma_histogram,
            rgb_histograms=cheap.rgb_histograms,
            clipped_shadows_pct=cheap.clipped_shadows_pct,
            clipped_highlights_pct=cheap.clipped_highlights_pct,
            median_luma=cheap.median_luma,
            contrast_p10_p90=cheap.contrast_p10_p90,
            color_palette=cheap.color_palette,
            cast_strength=cheap.cast_strength,
            cast_direction=cheap.cast_direction,
            region_stats=region_stats,
            estimated_white_point=soft.estimated_white_point,
            wb_neutral_confidence=soft.wb_neutral_confidence,
            grade_character=soft.grade_character,
            problems=soft.problems,
        )
        doc.image_context = ctx
        # Plan 2 autonomous-suggestion pass plugs in here later.
        return _Output.model_validate(ctx.model_dump(mode="json"))


def _compute_region_stats(
    image_rgb: np.ndarray,
    base_ctx,
    region_soft_fields: list[dict],
) -> list[RegionStats]:
    """For each candidate_region with a bbox, compute per-region stats.

    Regions without a bbox skip stats. is_skin_likely / is_sky_likely come
    from the Claude-augmented `region_soft_fields` keyed by label."""
    soft_by_label = {r.get("label"): r for r in region_soft_fields}
    out: list[RegionStats] = []
    h, w = image_rgb.shape[:2]
    for region in base_ctx.candidate_regions:
        if not region.bbox:
            continue
        x, y, bw, bh = region.bbox
        x0 = max(0, int(x * w)); y0 = max(0, int(y * h))
        x1 = min(w, int((x + bw) * w)); y1 = min(h, int((y + bh) * h))
        if x1 <= x0 or y1 <= y0:
            continue
        crop = image_rgb[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        luma = (
            0.299 * crop[:, :, 0] + 0.587 * crop[:, :, 1] + 0.114 * crop[:, :, 2]
        ).astype(np.uint8)
        hist, _ = np.histogram(luma, bins=32, range=(0, 256))
        p10 = float(np.percentile(luma, 10))
        p90 = float(np.percentile(luma, 90))
        # Saturation via HSV.
        import cv2
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        sat_mean = float(hsv[:, :, 1].mean()) / 255.0
        soft = soft_by_label.get(region.label, {})
        out.append(RegionStats(
            label=region.label,
            pixel_count=int((y1 - y0) * (x1 - x0)),
            mean_luma=float(luma.mean()),
            luma_histogram=hist.astype(int).tolist(),
            mean_rgb=(float(crop[:, :, 0].mean()), float(crop[:, :, 1].mean()), float(crop[:, :, 2].mean())),
            dominant_swatches=[],  # left empty in v2; could be filled by a second kmeans pass per region
            is_skin_likely=bool(soft.get("is_skin_likely", False)),
            is_sky_likely=bool(soft.get("is_sky_likely", False)),
            saturation_mean=sat_mean,
            contrast_p10_p90=p90 - p10,
        ))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_analyze_image.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/analyze_image.py backend/tests/tools/test_analyze_image.py
git commit -m "$(cat <<'EOF'
feat(tools): analyze_image now produces EnrichedImageContext v2

Combines existing base-context Claude call, the cheap-pass numpy stats,
and the new soft-fields Claude pass into one EnrichedImageContext per
session. Per-region stats join via the soft pass's per-label
is_skin_likely / is_sky_likely fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `FusedToolTemplate` framework

**Files:**
- Create: `backend/app/tools/fused_framework.py`
- Test: `backend/tests/tools/test_fused_framework.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_fused_framework.py
import pytest

from app.schemas.widget import (
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetOrigin,
)
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
    ResolverError,
    run_fused_tool,
)


class _AlwaysOutOfEnvelope(FusedToolTemplate):
    id = "out_of_env"
    description = "always returns out-of-envelope"
    typical_use = "test"
    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        )
    ]
    bindings_skeleton = [
        BindingSkeleton(
            param_key="temperature", label="Warmth",
            control_type="slider",
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        )
    ]
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "temperature": ParamRange(min=-1200, max=1200, step=50, skin_safe_max=400),
    }
    safety = {}
    context_inputs = []

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        return ResolvedNumbers(values={"temperature": 9999})  # way out of envelope


class _InEnvelope(_AlwaysOutOfEnvelope):
    id = "in_env"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        return ResolvedNumbers(values={"temperature": 800})


class _AlwaysRaises(_AlwaysOutOfEnvelope):
    id = "raises"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        raise ResolverError("nope")


def _scope_global():
    return Scope.model_validate({"kind": "global"})


def _ctx():
    from app.schemas.enriched_context import EnrichedImageContext
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_in_envelope_runs_first_try() -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert isinstance(widget, Widget)
    assert widget.nodes[0].params == {"temperature": 800}
    assert widget.bindings[0].value == 800


@pytest.mark.asyncio
async def test_triple_miss_falls_back_to_envelope_seed() -> None:
    template = _AlwaysOutOfEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    # Seed = envelope midpoint = (min + max) / 2 = 0
    assert widget.nodes[0].params == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_resolver_error_also_falls_back_to_seed() -> None:
    template = _AlwaysRaises()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.nodes[0].params == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_widget_carries_fused_tool_id_and_origin() -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.fused_tool_id == "in_env"
    assert widget.composed is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_fused_framework.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/fused_framework.py
from __future__ import annotations

import logging
import uuid
from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    ControlType,
    NodeParamTarget,
    ParamValue,
    ResolvedNumbers,  # defined in Plan 1
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)

logger = logging.getLogger(__name__)


class ResolverError(RuntimeError):
    pass


class ParamRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    min: float
    max: float
    step: float
    skin_safe_max: float | None = None


class NodeSkeleton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    node_type: str
    fixed_params: dict[str, ParamValue] = Field(default_factory=dict)
    tunable_param_keys: list[str] = Field(default_factory=list)


class BindingSkeleton(BaseModel):
    model_config = ConfigDict(extra="forbid")
    param_key: str
    label: str
    control_type: ControlType
    schema: ControlSchema
    target: NodeParamTarget
    tunable_default: bool = True


class FusedToolTemplate(ABC):
    id: str
    description: str
    typical_use: str
    node_skeleton: list[NodeSkeleton]
    bindings_skeleton: list[BindingSkeleton]
    preview: dict[str, Any]
    requires_scope: Literal["any", "non_global", "named_region", "skin_safe"]
    param_envelope: dict[str, ParamRange]
    safety: dict[str, Any]
    context_inputs: list[str]

    @abstractmethod
    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        ...


def _scope_is_skin_likely(scope: Scope, ctx: EnrichedImageContext | None) -> bool:
    if ctx is None:
        return False
    root = scope.root
    if root.kind == "named_region":
        for rs in ctx.region_stats:
            if rs.label == root.label and rs.is_skin_likely:
                return True
    return False


def _clamp(value: float, envelope: ParamRange, skin_safe: bool) -> float:
    upper = envelope.max
    if skin_safe and envelope.skin_safe_max is not None:
        upper = min(upper, envelope.skin_safe_max)
    return max(envelope.min, min(upper, value))


def _build_widget(
    template: FusedToolTemplate,
    intent: str,
    scope: Scope,
    numbers: ResolvedNumbers,
    origin: WidgetOrigin,
) -> Widget:
    node_id_by_target: dict[str, str] = {}
    nodes: list[WidgetNode] = []
    wid = f"w_{uuid.uuid4().hex[:8]}"
    for skeleton in template.node_skeleton:
        nid = f"n_{uuid.uuid4().hex[:6]}"
        params = dict(skeleton.fixed_params)
        for k in skeleton.tunable_param_keys:
            if k in numbers.values:
                params[k] = numbers.values[k]
        nodes.append(WidgetNode(
            id=nid, type=skeleton.node_type, params=params,
            scope=scope, inputs=[], widget_id=wid,
        ))
        node_id_by_target[skeleton.node_type] = nid

    bindings: list[ControlBinding] = []
    for skeleton in template.bindings_skeleton:
        target_node_id = skeleton.target.node_id
        # Translate "n_kelvin" placeholders to the actual minted node id by type.
        if target_node_id.startswith("n_"):
            # Look up by node-type when the placeholder names a type (n_kelvin -> kelvin)
            type_hint = target_node_id[2:]
            if type_hint in node_id_by_target:
                target_node_id = node_id_by_target[type_hint]
        value = numbers.values.get(skeleton.param_key, _envelope_midpoint(template, skeleton.param_key))
        default = value if skeleton.tunable_default else _envelope_midpoint(template, skeleton.param_key)
        bindings.append(ControlBinding(
            param_key=skeleton.param_key,
            label=skeleton.label,
            control_type=skeleton.control_type,
            target=NodeParamTarget(node_id=target_node_id, param_key=skeleton.target.param_key),
            schema=skeleton.schema,
            value=value,
            default=default,
        ))

    return Widget(
        id=wid,
        intent=intent,
        reasoning=numbers.reasoning,
        scope=scope,
        origin=origin,
        fused_tool_id=template.id,
        composed=False,
        nodes=nodes,
        bindings=bindings,
        preview=WidgetPreview(**template.preview),
        rejected_attempts=[],
        status="active",
        revision=1,
    )


def _envelope_midpoint(template: FusedToolTemplate, key: str) -> float:
    env = template.param_envelope.get(key)
    if env is None:
        return 0.0
    return (env.min + env.max) / 2.0


def _seed_numbers(template: FusedToolTemplate) -> ResolvedNumbers:
    return ResolvedNumbers(values={
        key: _envelope_midpoint(template, key)
        for key in template.param_envelope
    })


async def run_fused_tool(
    template: FusedToolTemplate,
    *,
    intent: str,
    scope: Scope,
    ctx: EnrichedImageContext | None,
    prior: Widget | None,
    instruction: str | None,
    anthropic: Any,
    origin: WidgetOrigin | None = None,
) -> Widget:
    """Resolve a fused tool. Try up to 3 times. On envelope violation, retry
    once with the clamp note in the resolver prompt. On triple-miss or
    resolver exception, seed with envelope midpoints."""
    skin_safe = _scope_is_skin_likely(scope, ctx)
    final_origin = origin or WidgetOrigin(kind="mcp_user_prompt", prompt=intent)
    for attempt in range(3):
        try:
            numbers = await template.resolve(intent, scope, ctx, prior, instruction, anthropic)
        except ResolverError as exc:
            logger.warning("fused_tool %s resolver error (attempt %d): %s", template.id, attempt, exc)
            continue

        # Envelope check.
        clamped_values: dict[str, ParamValue] = {}
        out_of_envelope = False
        for k, v in numbers.values.items():
            env = template.param_envelope.get(k)
            if env is None:
                clamped_values[k] = v
                continue
            if not isinstance(v, (int, float)):
                clamped_values[k] = v
                continue
            clamped = _clamp(float(v), env, skin_safe)
            if abs(clamped - float(v)) > 1e-6:
                out_of_envelope = True
            clamped_values[k] = clamped
        if not out_of_envelope:
            return _build_widget(template, intent, scope, numbers, final_origin)
        # Out of envelope — retry. (Resolver prompt assembly is the resolver's
        # job; the framework only logs.)
        logger.warning("fused_tool %s envelope violation (attempt %d); retrying", template.id, attempt)
        # On the last retry, accept clamped values and return.
        if attempt == 2:
            numbers.values = clamped_values
            return _build_widget(template, intent, scope, numbers, final_origin)
    # Triple miss / triple error: seed.
    logger.error("fused_tool %s triple-missed; seeding from envelope midpoints", template.id)
    return _build_widget(template, intent, scope, _seed_numbers(template), final_origin)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_fused_framework.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/fused_framework.py backend/tests/tools/test_fused_framework.py
git commit -m "$(cat <<'EOF'
feat(tools): FusedToolTemplate framework — skeleton, envelope, runner

run_fused_tool clamps to the per-param envelope, retries up to twice on
out-of-envelope returns, and seeds from envelope midpoints on triple-miss
or resolver exception. Skin-safe envelopes engage when the resolved scope
is skin-likely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: First fused tool — `warm_grade`

The other 8 fused tools follow the same shape; once `warm_grade` is fully tested, each subsequent tool needs only a new file + a focused test.

**Files:**
- Create: `backend/app/tools/fused/__init__.py`, `backend/app/tools/fused/warm_grade.py`
- Test: `backend/tests/tools/fused/__init__.py` (empty), `backend/tests/tools/fused/test_warm_grade.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/fused/test_warm_grade.py
import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.warm_grade import WarmGradeTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"temperature": 600, "highlight_warmth": 12, "saturation_lift": 4},
            "reasoning": "image is cool",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        cast_strength=0.4, cast_direction=(-6.0, -8.0), grade_character="cool-cinematic",
    )


@pytest.mark.asyncio
async def test_warm_grade_skeleton_is_stable() -> None:
    template = WarmGradeTemplate()
    widget = await run_fused_tool(
        template, intent="warm subject",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(),
        prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    node_types = [n.type for n in widget.nodes]
    assert node_types == ["kelvin", "basic"]
    binding_keys = [b.param_key for b in widget.bindings]
    assert set(binding_keys) >= {"temperature", "highlight_warmth", "saturation_lift"}


@pytest.mark.asyncio
async def test_warm_grade_numbers_inside_envelope() -> None:
    template = WarmGradeTemplate()
    widget = await run_fused_tool(
        template, intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(),
        prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    temp_binding = next(b for b in widget.bindings if b.param_key == "temperature")
    assert -1200 <= temp_binding.value <= 1200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/fused/test_warm_grade.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement `warm_grade`**

```python
# backend/app/tools/fused/warm_grade.py
from __future__ import annotations

from typing import Any

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import ControlSchema, NodeParamTarget, Scope, Widget
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
    ResolverError,
)


_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["values"],
    "properties": {
        "values": {
            "type": "object",
            "additionalProperties": False,
            "required": ["temperature", "highlight_warmth", "saturation_lift"],
            "properties": {
                "temperature": {"type": "number"},
                "highlight_warmth": {"type": "number"},
                "saturation_lift": {"type": "number"},
            },
        },
        "reasoning": {"type": "string"},
    },
}


class WarmGradeTemplate(FusedToolTemplate):
    id = "warm_grade"
    description = "Subjective 'warmer' — coordinated kelvin shift, highlight warmth, slight saturation."
    typical_use = "Use when the user asks to warm up the image, the subject, or a region."

    node_skeleton = [
        NodeSkeleton(node_type="kelvin", fixed_params={}, tunable_param_keys=["temperature"]),
        NodeSkeleton(
            node_type="basic", fixed_params={},
            tunable_param_keys=["highlights", "saturation"],
        ),
    ]

    bindings_skeleton = [
        BindingSkeleton(
            param_key="temperature", label="Warmth",
            control_type="slider",
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50, "unit": "K"}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="highlight_warmth", label="Highlight warmth",
            control_type="slider",
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -30, "max": 30, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="highlights"),
            tunable_default=True,
        ),
        BindingSkeleton(
            param_key="saturation_lift", label="Saturation lift",
            control_type="slider",
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -20, "max": 20, "step": 1}
            ),
            target=NodeParamTarget(node_id="n_basic", param_key="saturation"),
            tunable_default=True,
        ),
    ]

    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "temperature": ParamRange(min=-1200, max=1200, step=50, skin_safe_max=400),
        "highlight_warmth": ParamRange(min=-30, max=30, step=1, skin_safe_max=8),
        "saturation_lift": ParamRange(min=-20, max=20, step=1, skin_safe_max=5),
    }
    safety = {"skin_protect": True}
    context_inputs = ["cast_direction", "wb_neutral_confidence", "region_stats.mean_rgb", "grade_character"]

    async def resolve(
        self,
        intent: str,
        scope: Scope,
        ctx: EnrichedImageContext,
        prior_widget: Widget | None,
        instruction: str | None,
        anthropic: Any,
    ) -> ResolvedNumbers:
        prompt_payload = {
            "intent": intent,
            "scope": scope.model_dump(mode="json"),
            "context_summary": {
                "cast_direction": ctx.cast_direction,
                "wb_neutral_confidence": ctx.wb_neutral_confidence,
                "grade_character": ctx.grade_character,
            },
            "prior_widget_values": (
                {b.param_key: b.value for b in prior_widget.bindings}
                if prior_widget is not None else None
            ),
            "instruction": instruction,
        }
        try:
            raw = anthropic.resolve_fused_tool(
                template_id=self.id,
                prompt_payload=prompt_payload,
                response_schema=_RESPONSE_SCHEMA,
                session_id=getattr(ctx, "model_version", None),
            )
        except Exception as exc:
            raise ResolverError(str(exc)) from exc
        return ResolvedNumbers.model_validate(raw)
```

`tools/fused/__init__.py`:

```python
# backend/app/tools/fused/__init__.py
from typing import Iterable

from app.tools.fused_framework import FusedToolTemplate

from .warm_grade import WarmGradeTemplate


def all_fused_templates() -> Iterable[FusedToolTemplate]:
    yield WarmGradeTemplate()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/fused/test_warm_grade.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/fused/__init__.py backend/app/tools/fused/warm_grade.py backend/tests/tools/fused/__init__.py backend/tests/tools/fused/test_warm_grade.py
git commit -m "$(cat <<'EOF'
feat(fused): warm_grade — kelvin + highlight warmth + saturation lift

First fused-tool template. Three tunable params bound to two nodes;
envelopes carry skin_safe_max for scope-driven clamping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `resolve_fused_tool` on `AnthropicClient`

**Files:**
- Modify: `backend/app/services/anthropic_client.py`
- Test: extend `backend/tests/test_anthropic_client.py`

- [ ] **Step 1: Write the failing test**

```python
# Append
def test_resolve_fused_tool_returns_dict(monkeypatch) -> None:
    from app.services.anthropic_client import AnthropicClient

    class _FakeResponse:
        usage = type("U", (), {"cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "input_tokens": 0})()
        content = [type("Block", (), {
            "type": "tool_use",
            "name": "emit_fused_tool_values",
            "input": {"values": {"temperature": 700}, "reasoning": "image is cool"},
        })()]

    class _FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                return _FakeResponse()

    client = AnthropicClient(api_key="x", model="claude-opus-4-7")
    monkeypatch.setattr(client, "_client", _FakeClient())
    out = client.resolve_fused_tool(
        template_id="warm_grade",
        prompt_payload={"intent": "warm"},
        response_schema={"type": "object", "properties": {"values": {"type": "object"}}},
    )
    assert out["values"]["temperature"] == 700
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/test_anthropic_client.py::test_resolve_fused_tool_returns_dict -v`
Expected: AttributeError.

- [ ] **Step 3: Implement**

In `anthropic_client.py`:

```python
_FUSED_RESOLVE_PROMPT = """You are tuning the numeric parameters of a fused photo-edit \
tool. The user (or a prior call) supplies an intent and an image context summary. \
\
Emit a single `emit_fused_tool_values` tool_use whose input matches the response \
schema you are given. Stay within the param envelope hinted in the schema; the \
calling framework clamps anything outside the envelope and may retry. \
\
Do not return prose."""


    def resolve_fused_tool(
        self,
        template_id: str,
        prompt_payload: dict,
        response_schema: dict,
        session_id: str | None = None,
    ) -> dict:
        tool = {
            "name": "emit_fused_tool_values",
            "description": f"Emit tunable values for fused tool {template_id}",
            "input_schema": response_schema,
        }
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=[{"type": "text", "text": _FUSED_RESOLVE_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_fused_tool_values"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Template: {template_id}"},
                    {"type": "text", "text": f"Payload: {prompt_payload}"},
                ]},
            ],
        )
        _log_cache_stats(f"resolve_fused/{template_id}", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_fused_tool_values":
                return dict(block.input)
        raise RuntimeError(f"resolve_fused_tool: no tool_use for {template_id}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/test_anthropic_client.py::test_resolve_fused_tool_returns_dict -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/tests/test_anthropic_client.py
git commit -m "$(cat <<'EOF'
feat(anthropic): resolve_fused_tool — structured numeric resolver

Single tool_use call returning a dict matching the per-template
response_schema. Used by FusedToolTemplate.resolve subclasses.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Tasks 8–15: The other 8 fused tools

Each follows the **same shape** as Task 6:
1. Write a fused-tool test using a `_FakeAnthropic` that returns canned `values`.
2. Implement the template (`tools/fused/<id>.py`).
3. Register it in `tools/fused/__init__.py` (`all_fused_templates`).
4. Commit.

Below are the per-template specifics — skeleton, envelopes, and context inputs — that an engineer needs. The boilerplate code (response schema, resolve(), bindings) follows the warm_grade pattern.

### Task 8: `cool_grade`
Mirror of `warm_grade` with inverted envelopes. Same node_skeleton (kelvin + basic). Envelopes: temperature [-1200, 1200] but Claude is asked to go negative; same skin_safe_max=400. Test: assert resolver call is made, widget bindings exist, envelopes hold.

### Task 9: `exposure_balance`
Node skeleton: one `basic` node with tunables `shadows`, `highlights`, `whites`, `blacks`. Envelopes [-100, 100] each, skin_safe_max=30 on whites/blacks, 50 on shadows/highlights. Context inputs: `luma_histogram`, `clipped_shadows_pct`, `clipped_highlights_pct`, `median_luma`. Test: with `clipped_highlights_pct=20` in context, the resolver receives that in `prompt_payload.context_summary`.

### Task 10: `sky_recovery`
Skeleton: `basic` + `curves`. Tunables: `basic.highlights`, `basic.whites`, `basic.saturation` (channel-scoped, but represented as a single number for v1), and `curves.points` (curve binding). Envelope on `points`: each point [0, 1]. Context inputs: `clipped_highlights_pct`, sky region's dominant swatches.

### Task 11: `portrait_glow`
Skeleton: `basic` + `kelvin` (small). Tunables: clarity reduction (mapped to `basic.contrast` negative), small kelvin nudge. `requires_scope = "skin_safe"`. Envelopes are skin-safe tight. Context inputs: region `is_skin_likely`, `mean_luma`, dominant skin swatches.

### Task 12: `bw_cinematic`
Skeleton: `lut` (B&W preset id fixed in `fixed_params`) + `curves`. Tunable: curve points. Envelopes on curve points only. Context: `contrast_p10_p90`, `luma_histogram`.

### Task 13: `cast_correct`
Skeleton: `kelvin` + `basic` (per-channel sat via curves). Tunables: corrective `kelvin.temperature`, per-channel saturation deltas. Context: `estimated_white_point`, `cast_direction`, `wb_neutral_confidence`.

### Task 14: `teal_orange`
Skeleton: `curves` (per channel) + `basic` (saturation). Tunables: per-channel curve targets. Context: `grade_character`, `color_palette`.

### Task 15: `subject_pop`
Skeleton: `basic` (contrast, saturation). `requires_scope = "non_global"`. Tunables: contrast, saturation. Context: region `contrast_p10_p90`, `is_skin_likely`.

For each task:

- [ ] **Step 1: Test** — copy the warm_grade test, adjust expected node types + binding keys.
- [ ] **Step 2: Run-fail.**
- [ ] **Step 3: Implement** — copy `warm_grade.py`, edit the constants. Register in `fused/__init__.py`.
- [ ] **Step 4: Run-pass.**
- [ ] **Step 5: Commit** with message: `feat(fused): <id> — short description`.

The test pattern is uniform; once warm_grade is solid, each remaining template is ~10 minutes of focused edits.

---

## Task 16: `list_fused_tools` query tool

**Files:**
- Create: `backend/app/tools/atomic/list_fused_tools.py`
- Test: `backend/tests/tools/test_list_fused_tools.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_list_fused_tools.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_fused_tools import ListFusedToolsTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(ListFusedToolsTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("list_fused_tools", None)


def test_list_fused_tools_returns_catalog(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/list_fused_tools",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ids = {t["id"] for t in body["output"]["tools"]}
    assert "warm_grade" in ids
    entry = next(t for t in body["output"]["tools"] if t["id"] == "warm_grade")
    assert entry["param_envelope"]["temperature"]["min"] == -1200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_list_fused_tools.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/atomic/list_fused_tools.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates


class _Input(BaseModel):
    pass


class _ToolEntry(BaseModel):
    id: str
    description: str
    typical_use: str
    param_envelope: dict
    requires_scope: str


class _Output(BaseModel):
    tools: list[_ToolEntry] = Field(default_factory=list)


class ListFusedToolsTool(BackendTool[_Input, _Output]):
    name = "list_fused_tools"
    kind = "query"
    description = "List the available fused tools and their parameter envelopes."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        out = []
        for t in all_fused_templates():
            out.append(_ToolEntry(
                id=t.id,
                description=t.description,
                typical_use=t.typical_use,
                param_envelope={
                    k: v.model_dump() for k, v in t.param_envelope.items()
                },
                requires_scope=t.requires_scope,
            ))
        return _Output(tools=out)
```

Register in `tools/atomic/__init__.py`:

```python
from .list_fused_tools import ListFusedToolsTool

def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    # ...existing...
    registry.register(ListFusedToolsTool())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_list_fused_tools.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/list_fused_tools.py backend/app/tools/atomic/__init__.py backend/tests/tools/test_list_fused_tools.py
git commit -m "$(cat <<'EOF'
feat(tools): list_fused_tools — catalog query tool

Exposes the fused-tool catalog with envelopes and scope requirements,
so external Claude can browse before calling propose_widget.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `propose_widget` tool

**Files:**
- Create: `backend/app/tools/widgets/__init__.py`, `backend/app/tools/widgets/propose_widget.py`
- Test: `backend/tests/tools/widgets/__init__.py` (empty), `backend/tests/tools/widgets/test_propose_widget.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/widgets/test_propose_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        # Return values inside warm_grade's envelope.
        return {
            "values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3},
            "reasoning": "image is cool",
        }
    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    deps._anthropic_client = _FakeAnthropic()  # type: ignore
    deps.get_tool_registry().register(ProposeWidgetTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("propose_widget", None)


def _setup_session(client) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    # Seed an EnrichedImageContext directly so we don't depend on analyze in this test.
    from app.schemas.enriched_context import EnrichedImageContext
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    return sid


def test_propose_widget_with_explicit_fused_id(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer",
            "scope": {"kind": "global"},
            "fused_tool_id": "warm_grade",
        }},
    ).json()
    assert body["ok"] is True
    w = body["output"]["widget"]
    assert w["fused_tool_id"] == "warm_grade"
    binding_keys = [b["param_key"] for b in w["bindings"]]
    assert "temperature" in binding_keys


def test_propose_widget_with_no_fused_id_uses_name_pick(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warm subject",
            "scope": {"kind": "global"},
        }},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widget"]["fused_tool_id"] == "warm_grade"


def test_propose_widget_unknown_fused_id_returns_envelope_error(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer",
            "scope": {"kind": "global"},
            "fused_tool_id": "nope",
        }},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "fused_tool_not_found"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/widgets/test_propose_widget.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

`AnthropicClient.name_pick_fused_tool`:

```python
# Append to anthropic_client.py

_NAME_PICK_TOOL = {
    "name": "emit_chosen_fused_tool",
    "description": "Pick the most appropriate fused tool id for the given intent, or null.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["chosen_id"],
        "properties": {
            "chosen_id": {"type": ["string", "null"]},
            "reasoning": {"type": "string"},
        },
    },
}


    def name_pick_fused_tool(
        self, intent: str, candidates: list[dict], session_id: str | None = None,
    ) -> str | None:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=512,
            system=[{"type": "text", "text": "Pick the fused tool id whose description best matches the intent. Return null if nothing fits.", "cache_control": {"type": "ephemeral"}}],
            tools=[_NAME_PICK_TOOL],
            tool_choice={"type": "tool", "name": "emit_chosen_fused_tool"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Intent: {intent}"},
                    {"type": "text", "text": f"Candidates: {candidates}"},
                ]},
            ],
        )
        _log_cache_stats("name_pick_fused_tool", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_chosen_fused_tool":
                return block.input.get("chosen_id")
        return None
```

Then the tool itself:

```python
# backend/app/tools/widgets/propose_widget.py
from __future__ import annotations

from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import Scope, WidgetOrigin
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool


class _FusedToolNotFound(KeyError):
    pass


class _Input(BaseModel):
    intent: str = Field(min_length=1)
    scope: dict
    fused_tool_id: str | None = None
    prompt: str | None = None  # the user prompt this is responding to


class _Output(BaseModel):
    widget: dict


class ProposeWidgetTool(BackendTool[_Input, _Output]):
    name = "propose_widget"
    kind = "mutate"
    description = (
        "Mint a widget. If fused_tool_id is given, that template is used. Otherwise "
        "Claude picks one for the intent; if none fits, an ad-hoc widget is built."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        scope = Scope.model_validate(input.scope)
        templates = {t.id: t for t in all_fused_templates()}

        fused_id = input.fused_tool_id
        if fused_id is not None and fused_id not in templates:
            raise _FusedToolNotFound(fused_id)

        anthropic = deps.get_anthropic_client()
        if fused_id is None:
            candidates = [
                {"id": t.id, "description": t.description, "typical_use": t.typical_use}
                for t in templates.values()
            ]
            fused_id = anthropic.name_pick_fused_tool(
                intent=input.intent, candidates=candidates, session_id=doc.session_id,
            )
            if fused_id is None or fused_id not in templates:
                # Ad-hoc path lands in Plan 2.5 — for v1, fall back to warm_grade for any unmatched intent.
                fused_id = "warm_grade"

        template = templates[fused_id]
        origin = WidgetOrigin(
            kind="mcp_user_prompt", prompt=input.prompt or input.intent, parent_widget_id=None,
        )
        widget = await run_fused_tool(
            template,
            intent=input.intent, scope=scope, ctx=doc.image_context,
            prior=None, instruction=None, anthropic=anthropic,
            origin=origin,
        )
        doc.add_widget(widget)
        return _Output(widget=widget.model_dump(mode="json"))
```

Wire `_FusedToolNotFound` mapping into the registry's exception fan:

```python
        except KeyError as exc:
            ex_name = exc.__class__.__name__
            code = "unknown_widget"
            if ex_name == "_UnknownRegion":
                code = "unknown_region"
            elif ex_name == "_UnknownMask":
                code = "unknown_mask"
            elif ex_name == "_ScopeUnresolvable":
                code = "scope_unresolvable"
            elif ex_name == "_FusedToolNotFound":
                code = "fused_tool_not_found"
            return _err(code, str(exc), retryable=False)
```

Register in `tools/widgets/__init__.py`:

```python
# backend/app/tools/widgets/__init__.py
from app.tools.registry import BackendToolRegistry

from .propose_widget import ProposeWidgetTool


def register_all_widget_tools(registry: BackendToolRegistry) -> None:
    registry.register(ProposeWidgetTool())
```

And add the call to `register_all_widget_tools` inside `deps.get_tool_registry()` after `register_all_atomic_tools`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/widgets/test_propose_widget.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/app/tools/widgets/__init__.py backend/app/tools/widgets/propose_widget.py backend/app/tools/registry.py backend/app/api/deps.py backend/tests/tools/widgets/__init__.py backend/tests/tools/widgets/test_propose_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): propose_widget — fused-tool-driven widget creation

AnthropicClient gains name_pick_fused_tool for intent → fused-tool-id
routing. propose_widget either uses an explicit fused_tool_id or asks
Claude to pick one, then runs the template.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: `refine_widget` — composition edit

**Files:**
- Create: `backend/app/tools/widgets/refine_widget.py`
- Test: `backend/tests/tools/widgets/test_refine_widget.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/widgets/test_refine_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool
from app.tools.widgets.refine_widget import RefineWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3}, "reasoning": ""}
    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"
    def flesh_out_binding(self, request, widget, response_schema, session_id=None):
        # Return a canned new control binding for "skin protect" requests.
        return {
            "binding": {
                "param_key": "skin_protect",
                "label": "Skin protect",
                "control_type": "toggle",
                "target": {"node_id": "n_extra", "param_key": "skin_protect"},
                "schema": {"control_type": "toggle", "on_label": "Protect", "off_label": "Off"},
                "value": True,
                "default": True,
            },
            "additional_nodes": [
                {"type": "basic", "params": {"skin_protect": True}, "scope": {"kind": "global"}},
            ],
        }


@pytest.fixture
def client():
    from app.main import app
    deps._anthropic_client = _FakeAnthropic()  # type: ignore
    deps.get_tool_registry().register(ProposeWidgetTool())
    deps.get_tool_registry().register(RefineWidgetTool())
    yield TestClient(app)
    for n in ("propose_widget", "refine_widget"):
        deps.get_tool_registry()._tools.pop(n, None)


def _setup(client) -> tuple[str, str]:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    proposed = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade",
        }},
    ).json()
    return sid, proposed["output"]["widget"]["id"]


def test_refine_removes_a_binding(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [{"param_key": "saturation_lift", "action": "remove"}],
            "additions": [],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["param_key"] for b in body["output"]["widget"]["bindings"]]
    assert "saturation_lift" not in keys
    assert body["output"]["widget"]["composed"] is True


def test_refine_adds_a_binding(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [],
            "additions": [{"request": "add a skin-protect toggle"}],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["param_key"] for b in body["output"]["widget"]["bindings"]]
    assert "skin_protect" in keys
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/widgets/test_refine_widget.py -v`
Expected: ImportError + AttributeError on `flesh_out_binding`.

- [ ] **Step 3: Implement**

Add `flesh_out_binding` to `AnthropicClient`:

```python
_FLESH_BINDING_PROMPT = """You are extending a fused widget with a new binding. \
Given the existing widget and the user's request, emit one new ControlBinding \
and any WidgetNode additions it needs. Return only via the emit_new_binding tool."""


_FLESH_BINDING_TOOL = {
    "name": "emit_new_binding",
    "description": "Emit one new ControlBinding plus optional new nodes.",
    "input_schema": {
        "type": "object",
        "required": ["binding"],
        "properties": {
            "binding": {"type": "object"},
            "additional_nodes": {"type": "array"},
        },
    },
}


    def flesh_out_binding(
        self, request: str, widget: dict, response_schema: dict | None = None, session_id: str | None = None,
    ) -> dict:
        response = self._client.messages.create(
            model=self._model, max_tokens=1024,
            system=[{"type": "text", "text": _FLESH_BINDING_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[_FLESH_BINDING_TOOL],
            tool_choice={"type": "tool", "name": "emit_new_binding"},
            messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": f"Existing widget: {widget}"},
                    {"type": "text", "text": f"User request: {request}"},
                ]},
            ],
        )
        _log_cache_stats("flesh_out_binding", session_id, response)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "emit_new_binding":
                return dict(block.input)
        raise RuntimeError("flesh_out_binding: no tool_use returned")
```

Then the refine tool:

```python
# backend/app/tools/widgets/refine_widget.py
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
)
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import run_fused_tool


class _UnknownWidget(KeyError):
    pass


class BindingEdit(BaseModel):
    param_key: str
    action: Literal["keep", "remove"]


class BindingRequest(BaseModel):
    request: str = Field(min_length=1)
    control_type_hint: str | None = None
    target_hint: str | None = None


class _Input(BaseModel):
    widget_id: str
    edits: list[BindingEdit] = Field(default_factory=list)
    additions: list[BindingRequest] = Field(default_factory=list)
    instruction: str | None = None


class _Output(BaseModel):
    widget: dict


class RefineWidgetTool(BackendTool[_Input, _Output]):
    name = "refine_widget"
    kind = "mutate"
    description = (
        "Composition edit on a widget — keep/remove existing bindings, add new "
        "bindings from short phrases, optionally re-tune numbers with an instruction."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)

        anthropic = deps.get_anthropic_client()

        # Apply removals.
        to_remove = {e.param_key for e in input.edits if e.action == "remove"}
        kept_bindings = [b for b in w.bindings if b.param_key not in to_remove]

        # Add new bindings via Claude.
        new_bindings: list[ControlBinding] = []
        new_nodes: list[WidgetNode] = []
        for req in input.additions:
            fleshed = anthropic.flesh_out_binding(
                request=req.request,
                widget=w.model_dump(mode="json"),
                session_id=doc.session_id,
            )
            binding_dict = fleshed["binding"]
            new_bindings.append(ControlBinding.model_validate(binding_dict))
            for node_dict in fleshed.get("additional_nodes", []):
                nid = f"n_{uuid.uuid4().hex[:6]}"
                new_nodes.append(WidgetNode(
                    id=nid, type=node_dict["type"], params=node_dict.get("params", {}),
                    scope=Scope.model_validate(node_dict.get("scope", {"kind": "global"})),
                    inputs=[], widget_id=w.id,
                ))

        composition_changed = bool(to_remove) or bool(new_bindings)

        if composition_changed:
            # Graduate the widget out of pure fused-tool mode.
            w.composed = True
            w.bindings = kept_bindings + new_bindings
            w.nodes = w.nodes + new_nodes
            w.revision += 1
            doc.update_widget(w)
            return _Output(widget=w.model_dump(mode="json"))

        # No composition change → just re-tune numbers via the fused template.
        if w.fused_tool_id is None:
            # Ad-hoc widget refine without composition change is a no-op for v1.
            return _Output(widget=w.model_dump(mode="json"))
        templates = {t.id: t for t in all_fused_templates()}
        template = templates[w.fused_tool_id]
        new_widget = await run_fused_tool(
            template, intent=w.intent, scope=w.scope,
            ctx=doc.image_context, prior=w, instruction=input.instruction,
            anthropic=anthropic, origin=w.origin,
        )
        new_widget.id = w.id  # keep same id
        new_widget.revision = w.revision + 1
        doc.update_widget(new_widget)
        return _Output(widget=new_widget.model_dump(mode="json"))
```

Register in `tools/widgets/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/widgets/test_refine_widget.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/anthropic_client.py backend/app/tools/widgets/refine_widget.py backend/app/tools/widgets/__init__.py backend/tests/tools/widgets/test_refine_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): refine_widget — composition edits with Claude-fleshed bindings

Remove/keep existing bindings and request new ones via short phrases.
Composition changes graduate the widget out of pure fused-tool mode
(composed=true) while keeping the fused_tool_id as back-reference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: `repeat_widget` — re-roll with rejection anchor

**Files:**
- Create: `backend/app/tools/widgets/repeat_widget.py`
- Test: `backend/tests/tools/widgets/test_repeat_widget.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/widgets/test_repeat_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool
from app.tools.widgets.repeat_widget import RepeatWidgetTool


_call_counter = {"n": 0}


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        _call_counter["n"] += 1
        # Return a different value each call so we can verify re-roll happens.
        return {
            "values": {"temperature": 400 if _call_counter["n"] == 1 else 800,
                       "highlight_warmth": 6, "saturation_lift": 2},
            "reasoning": "",
        }
    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    _call_counter["n"] = 0
    deps._anthropic_client = _FakeAnthropic()  # type: ignore
    deps.get_tool_registry().register(ProposeWidgetTool())
    deps.get_tool_registry().register(RepeatWidgetTool())
    yield TestClient(app)
    for n in ("propose_widget", "repeat_widget"):
        deps.get_tool_registry()._tools.pop(n, None)


def _setup(client) -> tuple[str, str]:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    proposed = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade",
        }},
    ).json()
    return sid, proposed["output"]["widget"]["id"]


def test_repeat_re_rolls_and_logs_rejection(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True
    w = body["output"]["widget"]
    temp = next(b for b in w["bindings"] if b["param_key"] == "temperature")
    assert temp["value"] == 800
    doc = deps.get_session_store().get_document(sid)
    assert len(doc.widgets[wid].rejected_attempts) == 1


def test_repeat_rejects_composed_widget(client) -> None:
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[wid].composed = True
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/widgets/test_repeat_widget.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/widgets/repeat_widget.py
from __future__ import annotations

from pydantic import BaseModel

from app.api import deps
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import ResolvedNumbers, run_fused_tool


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    feedback: str | None = None


class _Output(BaseModel):
    widget: dict


class RepeatWidgetTool(BackendTool[_Input, _Output]):
    name = "repeat_widget"
    kind = "mutate"
    description = (
        "Re-roll a widget: ask Claude for a meaningfully different result for the "
        "same intent + scope. Only valid on un-composed fused-tool widgets."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        if w.fused_tool_id is None or w.composed:
            # ToolError envelope_violation isn't quite right — use invalid_input
            # since the input is structurally fine but precondition fails.
            from pydantic import ValidationError as VE
            raise VE.from_exception_data(
                "RepeatWidgetInput",
                [{"type": "value_error", "loc": ("widget_id",),
                  "msg": "repeat is only valid on un-composed fused-tool widgets",
                  "input": input.widget_id}],
            )

        templates = {t.id: t for t in all_fused_templates()}
        template = templates[w.fused_tool_id]
        # Record the prior numbers as rejected.
        current = ResolvedNumbers(values={b.param_key: b.value for b in w.bindings})
        w.rejected_attempts.append(current)

        instruction = input.feedback or "The user rejected the previous attempt. Produce a meaningfully different result for the same intent."
        anthropic = deps.get_anthropic_client()
        new_widget = await run_fused_tool(
            template, intent=w.intent, scope=w.scope, ctx=doc.image_context,
            prior=w, instruction=instruction, anthropic=anthropic, origin=w.origin,
        )
        new_widget.id = w.id
        new_widget.revision = w.revision + 1
        new_widget.rejected_attempts = w.rejected_attempts
        doc.update_widget(new_widget)
        return _Output(widget=new_widget.model_dump(mode="json"))
```

Register in `tools/widgets/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/widgets/test_repeat_widget.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/repeat_widget.py backend/app/tools/widgets/__init__.py backend/tests/tools/widgets/test_repeat_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): repeat_widget — re-roll with rejection anchor

Pushes the current numbers onto rejected_attempts and re-resolves the
template with an instruction that asks for a different result. Composed
widgets are rejected with invalid_input.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: `delete_widget` + `restore_widget`

**Files:**
- Create: `backend/app/tools/widgets/delete_widget.py`, `restore_widget.py`
- Test: `backend/tests/tools/widgets/test_delete_widget.py`, `test_restore_widget.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/widgets/test_delete_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.delete_widget import DeleteWidgetTool
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, *a, **k):
        return {"values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3}, "reasoning": ""}
    def name_pick_fused_tool(self, *a, **k):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    deps._anthropic_client = _FakeAnthropic()  # type: ignore
    deps.get_tool_registry().register(ProposeWidgetTool())
    deps.get_tool_registry().register(DeleteWidgetTool())
    yield TestClient(app)
    for n in ("propose_widget", "delete_widget"):
        deps.get_tool_registry()._tools.pop(n, None)


def _setup(client) -> tuple[str, str]:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    proposed = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade",
        }},
    ).json()
    return sid, proposed["output"]["widget"]["id"]


def test_delete_soft_dismisses_widget(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "dismissed"
    assert len(doc.dismissals) == 1
    assert doc.dismissals[0].source_widget_id == wid


def test_delete_without_suppression_creates_no_rule(client) -> None:
    sid, wid = _setup(client)
    client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    )
    doc = deps.get_session_store().get_document(sid)
    assert doc.dismissals == []
```

```python
# backend/tests/tools/widgets/test_restore_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.delete_widget import DeleteWidgetTool
from app.tools.widgets.propose_widget import ProposeWidgetTool
from app.tools.widgets.restore_widget import RestoreWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, *a, **k):
        return {"values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3}, "reasoning": ""}
    def name_pick_fused_tool(self, *a, **k):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    deps._anthropic_client = _FakeAnthropic()  # type: ignore
    for t in (ProposeWidgetTool, DeleteWidgetTool, RestoreWidgetTool):
        deps.get_tool_registry().register(t())
    yield TestClient(app)
    for n in ("propose_widget", "delete_widget", "restore_widget"):
        deps.get_tool_registry()._tools.pop(n, None)


def test_restore_clears_status_and_revokes_rule(client) -> None:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    wid = client.post("/api/tools/propose_widget", json={
        "session_id": sid, "input": {"intent": "w", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade"},
    }).json()["output"]["widget"]["id"]
    client.post("/api/tools/delete_widget", json={
        "session_id": sid, "input": {"widget_id": wid, "suppress_similar": True},
    })
    body = client.post("/api/tools/restore_widget", json={
        "session_id": sid, "input": {"widget_id": wid},
    }).json()
    assert body["ok"] is True
    assert doc.widgets[wid].status == "active"
    assert doc.dismissals == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/widgets/test_delete_widget.py backend/tests/tools/widgets/test_restore_widget.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/widgets/delete_widget.py
from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.widget import DismissalRule, Scope
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    suppress_similar: bool = True


class _Output(BaseModel):
    ok: bool


def _normalise_intent(s: str) -> str:
    return " ".join(s.lower().split())


def _scope_signature(scope: Scope) -> str:
    r = scope.root
    if r.kind == "global":
        return "global"
    if r.kind == "named_region":
        return f"named_region:{r.label}"
    return f"mask:{r.mask_id}"


class DeleteWidgetTool(BackendTool[_Input, _Output]):
    name = "delete_widget"
    kind = "mutate"
    description = "Dismiss a widget. Optionally suppress similar autonomous suggestions."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        rule = None
        if input.suppress_similar:
            rule = DismissalRule(
                id=f"d_{uuid.uuid4().hex[:8]}",
                source_widget_id=w.id,
                intent_norm=_normalise_intent(w.intent),
                scope_signature=_scope_signature(w.scope),
                fused_tool_id=w.fused_tool_id,
            )
        doc.dismiss_widget(input.widget_id, rule=rule)
        return _Output(ok=True)
```

```python
# backend/app/tools/widgets/restore_widget.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str


class _Output(BaseModel):
    ok: bool


class RestoreWidgetTool(BackendTool[_Input, _Output]):
    name = "restore_widget"
    kind = "mutate"
    description = "Un-dismiss a widget. Revokes any dismissal rule the delete created."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.widget_id not in doc.widgets:
            raise _UnknownWidget(input.widget_id)
        doc.restore_widget(input.widget_id)
        return _Output(ok=True)
```

Register both in `tools/widgets/__init__.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/widgets/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/delete_widget.py backend/app/tools/widgets/restore_widget.py backend/app/tools/widgets/__init__.py backend/tests/tools/widgets/test_delete_widget.py backend/tests/tools/widgets/test_restore_widget.py
git commit -m "$(cat <<'EOF'
feat(tools): delete_widget + restore_widget — soft-delete + suppress

delete_widget soft-dismisses and (by default) appends a DismissalRule
keyed by intent_norm + scope_signature + fused_tool_id so the autonomous-
suggestion pass won't re-propose. restore_widget reverses both.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: `accept_widget` + `set_widget_param`

**Files:**
- Create: `backend/app/tools/widgets/accept_widget.py`, `set_widget_param.py`
- Test: `backend/tests/tools/widgets/test_accept_widget.py`, `test_set_widget_param.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/tools/widgets/test_accept_widget.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetOrigin, WidgetPreview
from app.tools.widgets.accept_widget import AcceptWidgetTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(AcceptWidgetTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("accept_widget", None)


def test_accept_widget_emits_accepted_event(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(Widget(
        id="w_auto", intent="balance exposure",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        fused_tool_id="exposure_balance",
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    ))
    body = client.post(
        "/api/tools/accept_widget",
        json={"session_id": sid, "input": {"widget_id": "w_auto"}},
    ).json()
    assert body["ok"] is True
    assert any(ev.kind == "widget.accepted" for ev in doc.history)
```

```python
# backend/tests/tools/widgets/test_set_widget_param.py
import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.tools.widgets.set_widget_param import SetWidgetParamTool


@pytest.fixture
def client():
    from app.main import app
    deps.get_tool_registry().register(SetWidgetParamTool())
    yield TestClient(app)
    deps.get_tool_registry()._tools.pop("set_widget_param", None)


def test_set_widget_param_updates_binding_and_node(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(Widget(
        id="w_1", intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id="n_1", type="kelvin", params={"temperature": 500},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id="w_1",
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="Warmth",
            control_type="slider",
            target=NodeParamTarget(node_id="n_1", param_key="temperature"),
            schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            value=500, default=0,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    ))
    body = client.post(
        "/api/tools/set_widget_param",
        json={"session_id": sid, "input": {
            "widget_id": "w_1", "param_key": "temperature", "value": 800,
        }},
    ).json()
    assert body["ok"] is True
    assert doc.widgets["w_1"].bindings[0].value == 800
    assert doc.widgets["w_1"].nodes[0].params["temperature"] == 800
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/tools/widgets/test_accept_widget.py backend/tests/tools/widgets/test_set_widget_param.py -v`
Expected: ImportError.

- [ ] **Step 3: Implement**

```python
# backend/app/tools/widgets/accept_widget.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str


class _Output(BaseModel):
    ok: bool


class AcceptWidgetTool(BackendTool[_Input, _Output]):
    name = "accept_widget"
    kind = "mutate"
    description = "Move an autonomous-suggestion widget from the suggestions tray to active panel."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.widget_id not in doc.widgets:
            raise _UnknownWidget(input.widget_id)
        doc.accept_widget(input.widget_id)
        return _Output(ok=True)
```

```python
# backend/app/tools/widgets/set_widget_param.py
from __future__ import annotations

from pydantic import BaseModel

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    pass


class _UnknownBinding(KeyError):
    pass


class _Input(BaseModel):
    widget_id: str
    param_key: str
    value: float | int | str | bool | list | dict


class _Output(BaseModel):
    ok: bool


class SetWidgetParamTool(BackendTool[_Input, _Output]):
    name = "set_widget_param"
    kind = "mutate"
    description = (
        "Set a single binding's value on a widget. REST-only — slider-dragging "
        "is a human pointing-device action, not an agent action."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        binding = next((b for b in w.bindings if b.param_key == input.param_key), None)
        if binding is None:
            raise _UnknownBinding(input.param_key)
        binding.value = input.value
        # Propagate to the target node.
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is not None:
            node.params[binding.target.param_key] = input.value
        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
```

Register both.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/tools/widgets/ -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/accept_widget.py backend/app/tools/widgets/set_widget_param.py backend/app/tools/widgets/__init__.py backend/tests/tools/widgets/test_accept_widget.py backend/tests/tools/widgets/test_set_widget_param.py
git commit -m "$(cat <<'EOF'
feat(tools): accept_widget + set_widget_param

accept_widget moves autonomous suggestions into the active panel.
set_widget_param is REST-only — humans drag, agents propose/refine.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Autonomous-suggestion pass inside `analyze_image`

**Files:**
- Modify: `backend/app/tools/atomic/analyze_image.py`
- Test: extend `backend/tests/tools/test_analyze_image.py`

- [ ] **Step 1: Write the failing test**

```python
# Append
def test_autonomous_suggestions_minted_from_problems(client) -> None:
    from app.api import deps
    from io import BytesIO
    from PIL import Image
    buf = BytesIO(); Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]

    class _FakeFull(_FakeClaudeFull):  # type: ignore[name-defined]
        def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
            from app.services.anthropic_client import _ContextSoftFields
            from app.schemas.enriched_context import Problem
            return _ContextSoftFields(
                estimated_white_point=(255, 255, 255), wb_neutral_confidence=0.5,
                grade_character="neutral",
                problems=[Problem(
                    kind="clipped_highlights", severity=0.8, region_label=None,
                    bbox=None, suggested_fused_tools=["exposure_balance"],
                )],
                region_soft_fields=[],
            )
        def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
            # Return safe in-envelope values for exposure_balance.
            return {"values": {
                "shadows": 20, "highlights": -30, "whites": 0, "blacks": 0,
            }, "reasoning": ""}
        def name_pick_fused_tool(self, intent, candidates, session_id=None):
            return "exposure_balance"

    deps._anthropic_client = _FakeFull()
    client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    )
    doc = deps.get_session_store().get_document(sid)
    auto = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(auto) >= 1
    assert auto[0].fused_tool_id == "exposure_balance"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest backend/tests/tools/test_analyze_image.py -v`
Expected: no `mcp_autonomous` widgets are minted.

- [ ] **Step 3: Implement**

In `analyze_image.py`, after `doc.image_context = ctx`, add:

```python
        await _mint_autonomous_suggestions(doc, ctx, client)
        return _Output.model_validate(ctx.model_dump(mode="json"))


async def _mint_autonomous_suggestions(doc, ctx, anthropic) -> None:
    """For each high-severity Problem, run the suggested fused tool with
    origin.kind='mcp_autonomous'. Suggestions whose (fused_tool_id, scope)
    matches an existing dismissal rule are skipped."""
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

    templates = {t.id: t for t in all_fused_templates()}

    def _scope_for(problem) -> Scope:
        if problem.region_label:
            return Scope.model_validate({"kind": "named_region", "label": problem.region_label})
        return Scope.model_validate({"kind": "global"})

    def _dismissed(fused_id: str, scope: Scope) -> bool:
        sig = "global" if scope.root.kind == "global" else f"{scope.root.kind}:{getattr(scope.root, 'label', '')}"
        for rule in doc.dismissals:
            if rule.fused_tool_id == fused_id and rule.scope_signature == sig:
                return True
        return False

    for problem in ctx.problems:
        if problem.severity < 0.5:
            continue
        for fused_id in problem.suggested_fused_tools:
            if fused_id not in templates:
                continue
            scope = _scope_for(problem)
            if _dismissed(fused_id, scope):
                continue
            origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
            try:
                widget = await run_fused_tool(
                    templates[fused_id], intent=problem.kind.replace("_", " "),
                    scope=scope, ctx=ctx, prior=None, instruction=None,
                    anthropic=anthropic, origin=origin,
                )
            except Exception:
                continue
            doc.add_widget(widget)
            break  # one per problem
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest backend/tests/tools/test_analyze_image.py -v`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/analyze_image.py backend/tests/tools/test_analyze_image.py
git commit -m "$(cat <<'EOF'
feat(tools): analyze_image mints autonomous-suggestion widgets

After producing the EnrichedImageContext, problems[] with severity ≥ 0.5
drive run_fused_tool calls with origin.kind='mcp_autonomous'. Dismissal
rules gate re-proposal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Final regression sweep

- [ ] Run: `pytest backend/tests/ -v` — all tests pass.
- [ ] Smoke-test via curl the new tools (`propose_widget`, `refine_widget`, `repeat_widget`, `delete_widget`, `list_fused_tools`).
- [ ] Tag: `git tag plan2-fused-tools-complete`.

---

## Plan 2 — what's done and what's not

**Done:**
- EnrichedImageContext v2 (cheap + Claude-augmented passes).
- FusedToolTemplate framework + envelope clamp + retry + seed fallback.
- 9 fused templates: `warm_grade`, `cool_grade`, `exposure_balance`, `sky_recovery`, `portrait_glow`, `bw_cinematic`, `cast_correct`, `teal_orange`, `subject_pop`.
- Widget lifecycle tools: `propose_widget`, `refine_widget`, `repeat_widget`, `delete_widget`, `restore_widget`, `accept_widget`, `set_widget_param`.
- `list_fused_tools` query.
- Autonomous-suggestion pass in `analyze_image`.

**Deferred to Plan 3:**
- MCP wire format at `/mcp` (streamable HTTP).
- SSE state stream + snapshot at `/api/state/{sid}` + `/events`.
- CPU preview renderer + `preview_widget`.
- Rate limiting + MCP session pairing.
- Replacing `/api/panel` and `/api/refine` with thin shims around `propose_widget` / `refine_widget`.
- End-to-end MCP test.
