"""Selective op registration via the `module` field on RegistryOp."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.registry.loader import load_registry


_BASE_OP_PAYLOAD = {
    "displayName": "Stub Op",
    "llm": {
        "description": "stub",
        "typicalUse": "stub",
        "semanticTags": ["stub"],
    },
    "params": {
        "amount": {"type": "scalar", "range": [0, 1], "default": 0, "step": 0.01},
    },
    "bindings": [
        {"paramKey": "amount", "controlType": "slider", "label": "Amount"},
    ],
    "engine": {"shader": "stub", "renderOrder": 1, "nodeType": "basic"},
}


def _stub_op(path: Path, op_id: str, *, module: str | None = "core") -> None:
    """Write a minimal RegistryOp JSON. Pass `module=None` to omit the
    field entirely (legacy payload)."""
    data = {"id": op_id, **_BASE_OP_PAYLOAD}
    if module is not None:
        data["module"] = module
    path.write_text(json.dumps(data))


@pytest.fixture
def fake_registry(tmp_path: Path):
    """Build a tiny registry dir containing one op per module."""
    ops_dir = tmp_path / "ops"
    ops_dir.mkdir()
    _stub_op(ops_dir / "op-core.json", "op_core", module="core")
    _stub_op(ops_dir / "op-experimental.json", "op_experimental", module="experimental")
    _stub_op(ops_dir / "op-preset.json", "op_preset", module="preset")
    return tmp_path


def test_default_loads_core_and_preset_skips_experimental(fake_registry: Path):
    reg = load_registry(root=fake_registry)
    assert set(reg.ops.keys()) == {"op_core", "op_preset"}


def test_explicit_core_only(fake_registry: Path):
    reg = load_registry(root=fake_registry, modules={"core"})
    assert set(reg.ops.keys()) == {"op_core"}


def test_explicit_with_experimental(fake_registry: Path):
    reg = load_registry(
        root=fake_registry, modules={"core", "preset", "experimental"}
    )
    assert set(reg.ops.keys()) == {"op_core", "op_preset", "op_experimental"}


def test_env_var_drives_module_filter(
    fake_registry: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("EDITOR_OP_MODULES", "core,experimental")
    reg = load_registry(root=fake_registry)
    assert set(reg.ops.keys()) == {"op_core", "op_experimental"}


def test_module_field_defaults_to_core(tmp_path: Path):
    """Existing JSONs without `module` round-trip as core (no migration
    needed for the shipped op set)."""
    ops_dir = tmp_path / "ops"
    ops_dir.mkdir()
    _stub_op(ops_dir / "op-legacy.json", "op_legacy", module=None)
    reg = load_registry(root=tmp_path)
    assert "op_legacy" in reg.ops
    assert reg.ops["op_legacy"].module == "core"
