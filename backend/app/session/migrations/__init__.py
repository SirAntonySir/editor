"""Schema-version migrations for the persisted SessionDocument.

The on-disk shape of `document.v{N}.json` evolves over time. This package
holds the migrations that bring older payloads forward to the current
SCHEMA_VERSION so reviving a session from a previous backend release
remains safe.

How to add a migration when bumping SCHEMA_VERSION from N to N+1:

1. Add `vN_to_vN+1.py` with a `migrate(data: dict) -> dict` function.
   It receives a payload dict that has `_schema_version == N` and must
   return a payload with `_schema_version == N+1`.

2. Register it below by uncommenting / adding to `_MIGRATIONS`.

3. Bump `SCHEMA_VERSION` in `persistence.py`.

`migrate_to_current` walks the chain step-by-step so a v0 payload can
land on a v3 backend without a one-shot v0→v3 author having to exist.

Today there's only a v0→v1 stub (the format we ship as v1 has never had
a predecessor in the wild). It exists so the dispatcher path is
exercised before we need it for real.
"""

from __future__ import annotations

from typing import Any, Callable

from . import v0_to_v1

# Map each source version to the function that brings a payload one step
# closer to the current SCHEMA_VERSION. Keys are SOURCE versions; the
# function migrates from key → key+1.
_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {
    0: v0_to_v1.migrate,
}


class MigrationError(ValueError):
    """Raised when a payload's version is unknown or the chain is broken."""


def migrate_to_current(data: dict[str, Any], target_version: int) -> dict[str, Any]:
    """Walk `data` forward through registered migrations until its
    `_schema_version` matches `target_version`. Returns the (possibly
    same) dict — migrations are free to mutate in place or return a new
    object, callers should not rely on either.

    Raises MigrationError if:
      - the payload's current version > target (downgrade not supported)
      - no migration is registered for an intermediate version
    """
    current = int(data.get("_schema_version", 0))
    if current == target_version:
        return data
    if current > target_version:
        raise MigrationError(
            f"payload v{current} is newer than backend target v{target_version}; "
            "downgrade is not supported"
        )
    while current < target_version:
        step = _MIGRATIONS.get(current)
        if step is None:
            raise MigrationError(
                f"no migration registered for v{current} → v{current + 1}"
            )
        data = step(data)
        data["_schema_version"] = current + 1
        current += 1
    return data


__all__ = ["MigrationError", "migrate_to_current"]
