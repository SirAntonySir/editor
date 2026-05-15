from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Lighting = Literal["flat", "backlit", "side", "rim", "mixed"]
DominantTone = Literal["shadows", "midtones", "highlights"]


class CandidateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str
    # Normalised image coordinates (0–1). Optional — the analyse pass may
    # omit them if it can't localise the region. When SAM lands in Phase 4,
    # `representative_point` becomes the click input to the segmenter; `bbox`
    # is used in the meantime to draw a hover overlay on the preview.
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    representative_point: list[float] | None = Field(default=None, min_length=2, max_length=2)


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
