"""v0 → v1 — no-op stub.

There is no real v0 format in the wild; v1 is what shipped with the SSOT
session refactor. This migration exists to exercise the dispatcher path
so it's known-good the first time a real bump (v1 → v2) lands.

A "v0" payload is interpreted as an early dev artifact: it's whatever
the caller persisted before SCHEMA_VERSION was introduced. The migration
returns it unchanged — the caller's `_schema_version` field gets bumped
by the dispatcher.
"""

from __future__ import annotations

from typing import Any


def migrate(data: dict[str, Any]) -> dict[str, Any]:
    return data
