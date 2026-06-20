"""Shared pydantic ConfigDict that emits camelCase on the wire but still
accepts snake_case input (for tests + .edp files that predate the migration).

Usage:
    class CandidateRegion(BaseModel):
        model_config = camel_config(extra="forbid")
        candidate_regions: list[...] = Field(default_factory=list)

After this, `model.model_dump(mode="json", by_alias=True)` emits
`candidateRegions`. The default `model_dump()` (no by_alias) still emits
snake_case so internal Python callers are unaffected.
"""

from __future__ import annotations

from typing import Any

from pydantic import ConfigDict


def _to_camel(snake: str) -> str:
    head, *tail = snake.split("_")
    return head + "".join(part.capitalize() for part in tail)


def camel_config(**overrides: Any) -> ConfigDict:
    base: dict[str, Any] = dict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )
    base.update(overrides)
    return ConfigDict(**base)  # type: ignore[arg-type]
