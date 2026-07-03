"""Async client for Replicate's sync-mode prediction API (bria/genfill).

One purpose: image+mask+prompt in, PNG bytes out, with a typed error
taxonomy instead of exceptions. The API token comes from EnvSettings
(REPLICATE_API_TOKEN); an empty token yields `not_configured` so the
genfill tools degrade cleanly on unconfigured deploys.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Literal

import httpx

BRIA_GENFILL_URL = "https://api.replicate.com/v1/models/bria/genfill/predictions"

GenfillErrorKind = Literal["moderation", "timeout", "api_error", "not_configured"]


@dataclass(frozen=True)
class GenfillResult:
    ok: bool
    image_bytes: bytes | None
    seed: int
    error_kind: GenfillErrorKind | None = None
    error_message: str | None = None


def _data_uri(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _fail(seed: int, kind: GenfillErrorKind, message: str) -> GenfillResult:
    return GenfillResult(ok=False, image_bytes=None, seed=seed,
                         error_kind=kind, error_message=message)


class ReplicateClient:
    def __init__(
        self,
        api_token: str,
        *,
        timeout_s: float = 90.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token = api_token
        self._timeout = timeout_s
        self._transport = transport

    async def run_bria_genfill(
        self,
        *,
        image_bytes: bytes,
        image_mime: str,
        mask_png: bytes,
        prompt: str,
        negative_prompt: str | None,
        seed: int,
    ) -> GenfillResult:
        if not self._token:
            return _fail(seed, "not_configured", "REPLICATE_API_TOKEN is not set")

        payload: dict = {"input": {
            "image": _data_uri(image_bytes, image_mime),
            "mask": _data_uri(mask_png, "image/png"),
            "prompt": prompt,
            "seed": seed,
            "sync": True,
        }}
        if negative_prompt:
            payload["input"]["negative_prompt"] = negative_prompt
        headers = {"Authorization": f"Bearer {self._token}", "Prefer": "wait=60"}

        async with httpx.AsyncClient(
            timeout=self._timeout, transport=self._transport
        ) as client:
            # One retry on transport errors only — model/moderation errors are
            # billed per attempt and must NOT be retried.
            for attempt in (0, 1):
                try:
                    resp = await client.post(BRIA_GENFILL_URL, json=payload, headers=headers)
                    break
                except httpx.TimeoutException as exc:
                    return _fail(seed, "timeout", str(exc))
                except httpx.TransportError as exc:
                    if attempt == 1:
                        return _fail(seed, "api_error", f"transport error: {exc}")

            if resp.status_code >= 400:
                return _fail(seed, "api_error", f"HTTP {resp.status_code}: {resp.text[:300]}")

            body = resp.json()
            if body.get("status") == "failed" or body.get("error"):
                msg = str(body.get("error") or "prediction failed")
                kind: GenfillErrorKind = (
                    "moderation" if "moderat" in msg.lower() or "nsfw" in msg.lower()
                    else "api_error"
                )
                return _fail(seed, kind, msg)

            output = body.get("output")
            url = output[0] if isinstance(output, list) and output else output
            if not isinstance(url, str):
                return _fail(seed, "api_error", f"unexpected output shape: {output!r}")

            try:
                dl = await client.get(url)
            except httpx.TimeoutException as exc:
                return _fail(seed, "timeout", str(exc))
            except httpx.TransportError as exc:
                return _fail(seed, "api_error", f"download failed: {exc}")
            if dl.status_code >= 400:
                return _fail(seed, "api_error", f"download HTTP {dl.status_code}")
            return GenfillResult(ok=True, image_bytes=dl.content, seed=seed)
