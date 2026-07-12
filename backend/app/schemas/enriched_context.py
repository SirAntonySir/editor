from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas._camel import camel_config
from app.schemas.image_context import ImageContext


class ColorSwatch(BaseModel):
    model_config = camel_config(extra="forbid")
    rgb: tuple[int, int, int]
    weight: float = Field(ge=0.0, le=1.0)


ProblemKind = Literal[
    # Whole-image defects (region_label/bbox usually null).
    "clipped_highlights", "crushed_shadows", "low_contrast",
    "strong_color_cast", "noisy_shadows", "uneven_white_balance",
    # Element-local defects — only meaningful on a single candidate region;
    # the augment prompt requires region_label + bbox for these.
    "local_underexposure", "local_overexposure", "soft_focus",
    "distracting_element", "dull_subject", "skin_tone_shift",
    # Escape hatch: a real observation no kind above covers. Journal-only —
    # never minted into a widget (no tool mapping exists). Recurring `other`
    # observations across study sessions are the empirical candidates for
    # vocabulary growth (spec: problem vocabulary hybrid).
    "other",
]


class Problem(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: ProblemKind
    severity: float = Field(ge=0.0, le=1.0)
    region_label: str | None = None
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    # Registry op ids the analyzer recommends for this problem (e.g. ["light", "color"]).
    # Replaces suggested_fused_tools — analysis LLM now emits registry op ids directly.
    suggested_ops: list[str] = Field(default_factory=list)
    # DEPRECATED: legacy template ids; kept so persisted sessions validate.
    # Nothing writes this field anymore — consumers read suggested_ops instead.
    suggested_fused_tools: list[str] = Field(default_factory=list)
    # Free-text, image-specific name for the issue as seen in THIS photo
    # ("Blown-out sky behind the wires"). Becomes the minted widget's
    # display_name; `kind` stays the canonical analytics key.
    display_label: str | None = None
    # What was observed — primarily for kind="other", where it is the whole
    # payload of the journal-only observation.
    description: str | None = None


class RegionStats(BaseModel):
    model_config = camel_config(extra="forbid")
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
