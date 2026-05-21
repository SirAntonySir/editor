import pytest
from pydantic import ValidationError

from app.schemas.widget import (
    GlobalScope,
    MaskScope,
    NamedRegionScope,
    NodeParamTarget,
    Scope,
)


def test_scope_global() -> None:
    s = Scope.model_validate({"kind": "global"})
    assert isinstance(s.root, GlobalScope)


def test_scope_named_region() -> None:
    s = Scope.model_validate({"kind": "named_region", "label": "subject"})
    assert isinstance(s.root, NamedRegionScope)
    assert s.root.label == "subject"


def test_scope_mask() -> None:
    s = Scope.model_validate({"kind": "mask", "mask_id": "m_1"})
    assert isinstance(s.root, MaskScope)
    assert s.root.mask_id == "m_1"


def test_scope_unknown_kind_rejected() -> None:
    with pytest.raises(ValidationError):
        Scope.model_validate({"kind": "nonsense"})


def test_node_param_target_roundtrip() -> None:
    t = NodeParamTarget(node_id="n1", param_key="temperature")
    assert NodeParamTarget.model_validate(t.model_dump()) == t
