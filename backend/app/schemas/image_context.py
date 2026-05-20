from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Two-pass refinement schemas
# ---------------------------------------------------------------------------
# After pass 1 (Claude analyse + initial SAM), the backend renders an annotated
# composite (original + colored mask outlines + numbered labels) and asks
# Claude to refine. Claude returns a `ContextRefinements` describing, per
# region, whether to accept the current mask, drop the region (SAM result is
# unsalvageable), or re-run SAM with a richer prompt set.

Lighting = Literal["flat", "backlit", "side", "rim", "mixed"]
DominantTone = Literal["shadows", "midtones", "highlights"]


class CandidateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str
    # Normalised image coordinates (0–1). Optional — the analyse pass may
    # omit them if it can't localise the region. `representative_point` is the
    # click input to SAM; `bbox` is the Claude-proposed bounding rectangle.
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    representative_point: list[float] | None = Field(default=None, min_length=2, max_length=2)
    # Backend-refined SAM mask, expressed as one-or-more polygons in normalised
    # (0–1) image coordinates. Each polygon is a list of [x, y] points; multiple
    # polygons cover disjoint mask components. Populated by `_refine_regions`
    # after SAM runs; regions where SAM fails are dropped from the response.
    paths: list[list[list[float]]] | None = None


class ImageContext(BaseModel):
    model_config = ConfigDict(extra="forbid", protected_namespaces=())
    subjects: list[str] = Field(default_factory=list)
    lighting: Lighting
    dominant_tones: list[DominantTone] = Field(default_factory=list)
    mood: str
    candidate_regions: list[CandidateRegion] = Field(default_factory=list)
    model_name: str
    model_version: str
    generated_at: str  # ISO 8601 timestamp


class SamPromptSet(BaseModel):
    """Richer SAM prompts emitted by the refinement pass — supports a bbox plus
    multiple positive and negative click points. All coordinates normalised 0–1."""
    model_config = ConfigDict(extra="forbid")
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    positive_points: list[list[float]] = Field(default_factory=list)
    negative_points: list[list[float]] = Field(default_factory=list)


class RegionRefinement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # 1-based index into the regions presented to Claude (matches the label
    # drawn on the annotated composite image).
    region_index: int = Field(ge=1)
    action: Literal["accept", "refine", "drop"]
    # Required when action == "refine".
    refined_prompts: SamPromptSet | None = None


class ContextRefinements(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refinements: list[RegionRefinement] = Field(default_factory=list)
