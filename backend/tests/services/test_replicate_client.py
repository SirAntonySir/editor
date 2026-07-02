import base64
import json

import httpx

from app.services.replicate_client import GenfillResult, ReplicateClient

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)


def _client(handler) -> ReplicateClient:
    return ReplicateClient(api_token="tok", transport=httpx.MockTransport(handler))


async def test_not_configured_when_token_empty():
    c = ReplicateClient(api_token="")
    r = await c.run_bria_genfill(
        image_bytes=b"img", image_mime="image/jpeg", mask_png=PNG_1PX,
        prompt="a cat", negative_prompt=None, seed=7,
    )
    assert r == GenfillResult(ok=False, image_bytes=None, seed=7,
                              error_kind="not_configured",
                              error_message="REPLICATE_API_TOKEN is not set")


async def test_success_posts_data_uris_and_downloads_output():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.replicate.com":
            seen["headers"] = dict(request.headers)
            seen["payload"] = json.loads(request.content)
            return httpx.Response(201, json={
                "status": "succeeded",
                "output": ["https://replicate.delivery/xyz/out.png"],
            })
        assert request.url.host == "replicate.delivery"
        return httpx.Response(200, content=b"RESULT_PNG")

    r = await _client(handler).run_bria_genfill(
        image_bytes=b"img", image_mime="image/jpeg", mask_png=PNG_1PX,
        prompt="a cat", negative_prompt="dogs", seed=42,
    )
    assert r.ok and r.image_bytes == b"RESULT_PNG" and r.seed == 42
    inp = seen["payload"]["input"]
    assert inp["image"].startswith("data:image/jpeg;base64,")
    assert inp["mask"].startswith("data:image/png;base64,")
    assert inp["prompt"] == "a cat"
    assert inp["negative_prompt"] == "dogs"
    assert inp["seed"] == 42
    assert inp["sync"] is True
    assert seen["headers"]["authorization"] == "Bearer tok"
    assert seen["headers"]["prefer"] == "wait=60"


async def test_moderation_error_mapped():
    def handler(request):
        return httpx.Response(201, json={"status": "failed",
                                         "error": "flagged by content moderation"})
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "moderation"


async def test_api_error_on_http_error_status():
    def handler(request):
        return httpx.Response(500, text="boom")
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "api_error"


async def test_transport_error_retried_once_then_api_error():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        raise httpx.ConnectError("nope")

    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert calls["n"] == 2
    assert not r.ok and r.error_kind == "api_error"


async def test_timeout_mapped():
    def handler(request):
        raise httpx.ReadTimeout("slow")
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "timeout"
