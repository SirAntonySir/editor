from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]


class ToolError(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: ErrorCode
    message: str
    retryable: bool
    recovery_hint: str | None = None
    details: dict | None = None


class ToolResponseEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ok: bool
    output: dict | None = None
    error: ToolError | None = None

    @model_validator(mode="after")
    def _check_envelope(self) -> "ToolResponseEnvelope":
        if self.ok and self.output is None:
            raise ValueError("ok=True requires output")
        if not self.ok and self.error is None:
            raise ValueError("ok=False requires error")
        return self
