from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, model_validator

from app.schemas._camel import camel_config

ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask", "orphan_binding",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]


class ToolError(BaseModel):
    model_config = camel_config(extra="forbid")
    code: ErrorCode
    message: str
    retryable: bool
    recovery_hint: str | None = None
    details: dict[str, Any] | None = None


class ToolResponseEnvelope(BaseModel):
    model_config = camel_config(extra="forbid")
    ok: bool
    output: dict | None = None
    error: ToolError | None = None

    @model_validator(mode="after")
    def _check_envelope(self) -> "ToolResponseEnvelope":
        if self.ok and self.output is None:
            raise ValueError("ok=True requires output")
        if self.ok and self.error is not None:
            raise ValueError("ok=True must not have error set")
        if not self.ok and self.error is None:
            raise ValueError("ok=False requires error")
        if not self.ok and self.output is not None:
            raise ValueError("ok=False must not have output set")
        return self
