"""Shared inbound-image validation for session-create entry points.

Two surfaces accept user-supplied image bytes to mint a session:

- ``api/session.py``     — REST ``POST /api/session`` (multipart File upload)
- ``tools/atomic/create_session.py`` — MCP ``create_session`` tool (base64 body)

Both go through :class:`SessionStore.create` afterwards, but the cap on
payload size and the MIME-type guard belong before that call: without them
an MCP client could mint sessions with arbitrary content types or above
the configured ``max_image_bytes`` limit, bypassing the protection the
REST path enforces. Centralising the check here keeps the two surfaces
honest. Each surface translates :class:`ImageValidationError` into its
native error envelope (HTTPException for REST, tool envelope for MCP).
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings


class ImageValidationError(ValueError):
    """Raised when inbound image bytes fail validation.

    The HTTP status hint mirrors the canonical REST behaviour:
    * 415 for an unsupported MIME type
    * 413 for payload too large
    Domain-layer code raises this; transport layers translate.
    """

    def __init__(self, message: str, *, http_status: int) -> None:
        super().__init__(message)
        self.http_status = http_status


@dataclass(frozen=True)
class ValidatedImage:
    image_bytes: bytes
    mime_type: str


# Content-Length counts the whole multipart body (boundaries + part headers +
# any extra fields), not just the image bytes, so the pre-read guard adds a
# generous margin over max_image_bytes. It is only a coarse OOM backstop — the
# precise limit is enforced on the decoded image bytes in validate_image_upload.
_UPLOAD_OVERHEAD_BYTES = 1 * 1024 * 1024


def reject_oversize_content_length(content_length: int | None) -> None:
    """Cheap pre-read guard against OOM: reject an upload whose declared
    ``Content-Length`` is so far over the cap that buffering it would risk
    exhausting memory, BEFORE the body is read. The precise per-image check
    still runs in :func:`validate_image_upload`."""
    if content_length is None:
        return
    settings = get_settings()
    ceiling = settings.max_image_bytes + _UPLOAD_OVERHEAD_BYTES
    if content_length > ceiling:
        raise ImageValidationError(
            f"image too large ({content_length} > {ceiling} bytes)",
            http_status=413,
        )


def validate_image_upload(image_bytes: bytes, mime_type: str | None) -> ValidatedImage:
    """Apply the shared MIME + size checks. Returns a frozen :class:`ValidatedImage`
    on success; raises :class:`ImageValidationError` with the appropriate
    canonical HTTP status hint otherwise.

    Note: an empty ``mime_type`` (some upload sources, including clipboard paste,
    leave it blank in the multipart form) is rejected by the MIME guard. Callers
    that want to default to ``application/octet-stream`` must do so before this
    check.
    """
    if not mime_type or not mime_type.startswith("image/"):
        raise ImageValidationError(
            "image/* MIME type required",
            http_status=415,
        )
    settings = get_settings()
    if len(image_bytes) > settings.max_image_bytes:
        raise ImageValidationError(
            f"image too large ({len(image_bytes)} > {settings.max_image_bytes} bytes)",
            http_status=413,
        )
    return ValidatedImage(image_bytes=image_bytes, mime_type=mime_type)
