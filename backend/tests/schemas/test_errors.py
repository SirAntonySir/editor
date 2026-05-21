import pytest
from pydantic import ValidationError

from app.schemas.errors import ErrorCode, ToolError, ToolResponseEnvelope


def test_error_codes_include_required_values() -> None:
    required = {
        "missing_session", "missing_image", "missing_context",
        "invalid_input", "unknown_tool", "unknown_widget",
        "unknown_region", "unknown_mask",
        "scope_unresolvable", "sam_failed",
        "llm_validation_failed", "llm_envelope_violation",
        "fused_tool_not_found", "skin_safety_violation",
        "transport_error", "internal_error",
    }
    assert set(ErrorCode.__args__) == required


def test_tool_error_roundtrip() -> None:
    err = ToolError(
        code="missing_context",
        message="call analyze_image first",
        retryable=True,
        recovery_hint="call analyze_image first",
    )
    dumped = err.model_dump()
    assert ToolError.model_validate(dumped) == err


def test_envelope_ok_requires_output() -> None:
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=True, output=None)


def test_envelope_fail_requires_error() -> None:
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=False, error=None)


def test_envelope_ok_success_path() -> None:
    env = ToolResponseEnvelope(ok=True, output={"hello": "world"})
    assert env.error is None
    assert env.output == {"hello": "world"}


def test_envelope_fail_success_path() -> None:
    err = ToolError(code="invalid_input", message="bad", retryable=False)
    env = ToolResponseEnvelope(ok=False, error=err)
    assert env.output is None


def test_envelope_ok_rejects_error_present() -> None:
    err = ToolError(code="invalid_input", message="bad", retryable=False)
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=True, output={"x": 1}, error=err)


def test_envelope_fail_rejects_output_present() -> None:
    err = ToolError(code="invalid_input", message="bad", retryable=False)
    with pytest.raises(ValidationError):
        ToolResponseEnvelope(ok=False, error=err, output={"x": 1})
