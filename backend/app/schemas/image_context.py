from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Lighting = Literal["flat", "backlit", "side", "rim", "mixed"]
DominantTone = Literal["shadows", "midtones", "highlights"]


class CandidateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str


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
