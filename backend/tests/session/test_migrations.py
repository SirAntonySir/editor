"""Schema-version migration dispatcher."""

from __future__ import annotations

import pytest

from app.session.migrations import MigrationError, migrate_to_current


def test_noop_when_already_at_target():
    data = {"_schema_version": 1, "session_id": "sid"}
    out = migrate_to_current(data, target_version=1)
    assert out["_schema_version"] == 1
    assert out["session_id"] == "sid"


def test_v0_to_v1_bumps_version_via_stub():
    data = {"_schema_version": 0, "session_id": "sid"}
    out = migrate_to_current(data, target_version=1)
    assert out["_schema_version"] == 1


def test_missing_version_treated_as_v0():
    data = {"session_id": "sid"}  # no _schema_version
    out = migrate_to_current(data, target_version=1)
    assert out["_schema_version"] == 1


def test_payload_newer_than_target_raises():
    data = {"_schema_version": 99, "session_id": "sid"}
    with pytest.raises(MigrationError, match="downgrade is not supported"):
        migrate_to_current(data, target_version=1)


def test_missing_migration_in_chain_raises():
    # Simulate target=3 but only v0→v1 is registered — chain breaks at v1.
    data = {"_schema_version": 0, "session_id": "sid"}
    with pytest.raises(MigrationError, match="no migration registered for v1"):
        migrate_to_current(data, target_version=3)
