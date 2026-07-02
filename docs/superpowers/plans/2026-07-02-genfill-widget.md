# Genfill Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mask-based generative fill via Replicate `bria/genfill` — generated pixels land on a new layer (never mutating the original), optionally clipped by the same input mask.

**Architecture:** Backend owns the Replicate call, result asset storage, and widget provenance in the `SessionStateSnapshot` (a new `genfill` block on `Widget`, no operation-graph nodes). Frontend owns the preview, the clip toggle, and new-layer creation at Accept (client-side `destination-in` clip). Spec: `docs/superpowers/specs/2026-07-02-genfill-widget-design.md`.

**Tech Stack:** FastAPI + Pydantic v2 + httpx (backend), React 19 + Zustand + OffscreenCanvas (frontend), pytest + vitest.

## Global Constraints

- Work on branch `feat/genfill-widget` (create from `main`; CLAUDE.md: never develop directly on `main`).
- `npm run check` (gen:types check + `tsc -b` + `eslint .` + vitest) must pass before every commit.
- Backend tests: `cd backend && source .venv/bin/activate && python -m pytest tests -q`.
- After ANY change to `backend/app/schemas/widget.py`, run `npm run gen:types` and commit the regenerated `shared/schemas/*.json` + `shared/types/generated.ts` in the same commit.
- No inline-defined React components (module scope or sibling file only). Named Lucide imports only. Style via design tokens in `src/index.css`.
- The Replicate key is `REPLICATE_API_TOKEN` in backend `.env` — the user adds the value; code must degrade cleanly (`not_configured` error) when unset. NEVER send the key to the frontend.
- Genfill widgets carry NO operation-graph nodes and NO bindings — the WebGL pipeline must never see them.
- Deviation from spec, agreed during planning: `genfill` status gains a fourth value `compose` (right-click spawns a widget with an empty prompt; generation starts on first submit). `genfill_create` therefore ACCEPTS an empty prompt (creates a `compose` widget, no generation); `genfill_regenerate` requires a non-empty effective prompt.

---

### Task 1: Backend settings + Replicate client service

**Files:**
- Modify: `backend/app/config/env.py` (add one field)
- Create: `backend/app/services/replicate_client.py`
- Test: `backend/tests/services/test_replicate_client.py`
- Modify: `render.yaml` (declare env var), `backend/.env.example` if it exists (add `REPLICATE_API_TOKEN=`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ReplicateClient(api_token, timeout_s=90.0, transport=None)` with `async run_bria_genfill(*, image_bytes: bytes, image_mime: str, mask_png: bytes, prompt: str, negative_prompt: str | None, seed: int) -> GenfillResult`; `GenfillResult(ok, image_bytes, seed, error_kind, error_message)` where `error_kind ∈ {'moderation','timeout','api_error','not_configured'} | None`. Task 4 constructs the client via `ReplicateClient(api_token=get_settings().replicate_api_token)`.

- [ ] **Step 1: Add the setting**

In `backend/app/config/env.py`, inside `EnvSettings`, after `anthropic_sonnet_model`:

```python
    # Replicate API token for image-generation models (bria/genfill). Empty =
    # genfill tools return a typed `not_configured` error instead of raising.
    replicate_api_token: str = ""
```

In `render.yaml`, add alongside the existing `ANTHROPIC_API_KEY` env var declaration (match the file's existing style, `sync: false` for secrets):

```yaml
      - key: REPLICATE_API_TOKEN
        sync: false
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/services/test_replicate_client.py`:

```python
import base64
import json

import httpx
import pytest

from app.services.replicate_client import GenfillResult, ReplicateClient

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)


def _client(handler) -> ReplicateClient:
    return ReplicateClient(api_token="tok", transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_not_configured_when_token_empty():
    c = ReplicateClient(api_token="")
    r = await c.run_bria_genfill(
        image_bytes=b"img", image_mime="image/jpeg", mask_png=PNG_1PX,
        prompt="a cat", negative_prompt=None, seed=7,
    )
    assert r == GenfillResult(ok=False, image_bytes=None, seed=7,
                              error_kind="not_configured",
                              error_message="REPLICATE_API_TOKEN is not set")


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_moderation_error_mapped():
    def handler(request):
        return httpx.Response(201, json={"status": "failed",
                                         "error": "flagged by content moderation"})
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "moderation"


@pytest.mark.asyncio
async def test_api_error_on_http_error_status():
    def handler(request):
        return httpx.Response(500, text="boom")
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "api_error"


@pytest.mark.asyncio
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


@pytest.mark.asyncio
async def test_timeout_mapped():
    def handler(request):
        raise httpx.ReadTimeout("slow")
    r = await _client(handler).run_bria_genfill(
        image_bytes=b"i", image_mime="image/png", mask_png=PNG_1PX,
        prompt="x", negative_prompt=None, seed=1,
    )
    assert not r.ok and r.error_kind == "timeout"
```

Note: if `pytest.mark.asyncio` isn't configured in this repo (check `backend/pyproject.toml` / existing async tests — e.g. `grep -rn "asyncio" backend/tests | head`), use the same async-test convention the existing suite uses (`anyio`, `asyncio_mode = auto`, or `asyncio.run(...)` inside sync tests) and adapt the decorators accordingly.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_replicate_client.py -q`
Expected: FAIL — `ModuleNotFoundError: app.services.replicate_client`

- [ ] **Step 4: Implement the client**

Create `backend/app/services/replicate_client.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_replicate_client.py -q`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add backend/app/config/env.py backend/app/services/replicate_client.py backend/tests/services/test_replicate_client.py render.yaml
git commit -m "feat(genfill): Replicate client service + REPLICATE_API_TOKEN setting"
```

---

### Task 2: Widget schema — `genfill` block (backend + shared types + frontend types)

**Files:**
- Modify: `backend/app/schemas/widget.py` (after `ResolvedNumbers`, and one field on `Widget`)
- Modify: `src/types/widget.ts` (Widget interface + new interfaces)
- Regenerate: `shared/schemas/*.json`, `shared/types/generated.ts` via `npm run gen:types`
- Test: `backend/tests/schemas/test_genfill_state.py`

**Interfaces:**
- Produces (backend): `GenfillState(status, prompt, negative_prompt, seed, mask_id, image_node_id, result, error)`, `GenfillResultInfo(asset_id, width, height)`, `GenfillError(kind, message)`; `Widget.genfill: GenfillState | None = None`. Status values: `'compose' | 'generating' | 'ready' | 'error'`.
- Produces (frontend): `Widget.genfill?: GenfillState | null` with camelCase keys (`negativePrompt`, `maskId`, `imageNodeId`, `result.assetId`) — `camel_config` serializes by alias.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/schemas/test_genfill_state.py`:

```python
from app.schemas.widget import (
    GenfillError, GenfillResultInfo, GenfillState, Scope, Widget, WidgetOrigin,
)


def _widget(genfill: GenfillState) -> Widget:
    return Widget(
        id="w_g1",
        intent="Generative fill",
        scope=Scope.model_validate({"kind": "mask", "maskId": "m1"}),
        origin=WidgetOrigin(kind="tool_invoked"),
        genfill=genfill,
    )


def test_genfill_widget_round_trips_camel():
    w = _widget(GenfillState(
        status="ready", prompt="a red boat", negative_prompt=None, seed=42,
        mask_id="m1", image_node_id="in-default",
        result=GenfillResultInfo(asset_id="genfill-w_g1", width=1024, height=768),
    ))
    dumped = w.model_dump(mode="json", by_alias=True)
    g = dumped["genfill"]
    assert g["status"] == "ready"
    assert g["maskId"] == "m1"
    assert g["imageNodeId"] == "in-default"
    assert g["result"]["assetId"] == "genfill-w_g1"
    # Round-trip
    again = Widget.model_validate(dumped)
    assert again.genfill is not None and again.genfill.result.width == 1024


def test_widget_without_genfill_defaults_none():
    w = Widget(
        id="w_p", intent="x",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt"),
    )
    assert w.genfill is None
    assert w.model_dump(mode="json", by_alias=True)["genfill"] is None


def test_genfill_error_state():
    w = _widget(GenfillState(
        status="error", prompt="x", seed=1, mask_id="m1", image_node_id="in-default",
        error=GenfillError(kind="moderation", message="blocked"),
    ))
    g = w.model_dump(mode="json", by_alias=True)["genfill"]
    assert g["error"] == {"kind": "moderation", "message": "blocked"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/schemas/test_genfill_state.py -q`
Expected: FAIL — `ImportError: cannot import name 'GenfillState'`

- [ ] **Step 3: Add the models**

In `backend/app/schemas/widget.py`, insert after `ResolvedNumbers` (before `class Widget`):

```python
GenfillStatus = Literal["compose", "generating", "ready", "error"]
GenfillErrorKindLit = Literal["moderation", "timeout", "api_error", "not_configured"]


class GenfillResultInfo(BaseModel):
    model_config = camel_config(extra="forbid")
    asset_id: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class GenfillError(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: GenfillErrorKindLit
    message: str


class GenfillState(BaseModel):
    """State block for generative-fill widgets. Genfill widgets carry NO
    operation-graph nodes and NO bindings — they produce pixels, not shader
    params. The WebGL pipeline never sees them; the frontend renders a
    bespoke body from this block and creates a new layer at Accept."""
    model_config = camel_config(extra="forbid")
    status: GenfillStatus
    prompt: str = ""
    negative_prompt: str | None = None
    seed: int = 0
    mask_id: str = Field(min_length=1)
    image_node_id: str = Field(min_length=1)
    result: GenfillResultInfo | None = None
    error: GenfillError | None = None
```

On `class Widget`, after `dismissed_at_revision`:

```python
    # Generative-fill state block. Non-None marks this widget as a genfill
    # widget (bespoke frontend body, no op-graph nodes, pixels land on a new
    # layer at accept). See docs/superpowers/specs/2026-07-02-genfill-widget-design.md.
    genfill: GenfillState | None = None
```

- [ ] **Step 4: Run test to verify it passes, regenerate shared types**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/schemas/test_genfill_state.py -q`
Expected: 3 passed

Run: `npm run gen:types` (from repo root)
Expected: `shared/schemas/widget.schema.json`, `shared/schemas/combined.schema.json`, `shared/types/generated.ts` updated with the genfill block.

- [ ] **Step 5: Add the frontend hand-written types**

In `src/types/widget.ts`, add above the `Widget` interface:

```typescript
export type GenfillStatus = 'compose' | 'generating' | 'ready' | 'error';

export interface GenfillResultInfo {
  assetId: string;
  width: number;
  height: number;
}

export interface GenfillErrorInfo {
  kind: 'moderation' | 'timeout' | 'api_error' | 'not_configured';
  message: string;
}

/** State block for generative-fill widgets (Replicate bria/genfill).
 *  Non-null marks the widget as genfill: bespoke body, no op-graph nodes,
 *  pixels land on a NEW layer at Accept. */
export interface GenfillState {
  status: GenfillStatus;
  prompt: string;
  negativePrompt?: string | null;
  seed: number;
  maskId: string;
  imageNodeId: string;
  result?: GenfillResultInfo | null;
  error?: GenfillErrorInfo | null;
}
```

And inside `interface Widget` (after `category?: string | null;`):

```typescript
  genfill?: GenfillState | null;
```

- [ ] **Step 6: Verify frontend checks pass**

Run: `npm run check`
Expected: PASS (gen:types check clean, tsc clean).

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/widget.py backend/tests/schemas/test_genfill_state.py src/types/widget.ts shared/
git commit -m "feat(genfill): GenfillState schema block on Widget (backend + shared + frontend types)"
```

---

### Task 3: Session asset I/O + asset route

**Files:**
- Modify: `backend/app/services/disk_session_io.py` (three functions + one guard)
- Modify: `backend/app/api/session.py` (one GET route — follow the file's existing router/deps conventions)
- Test: `backend/tests/services/test_session_assets.py`

**Interfaces:**
- Produces: `write_asset(sid: str, asset_id: str, data: bytes) -> None`, `read_asset(sid: str, asset_id: str) -> bytes | None`, `delete_asset(sid: str, asset_id: str) -> None` (all in `disk_session_io`; assets stored as `<asset_id>.png` in the session dir). Route: `GET /api/session/{sid}/assets/{asset_id}` → `image/png` bytes or 404. Asset ids must match `genfill-[A-Za-z0-9_-]+`.
- CRITICAL side-fix: `read_per_node_images()` scans the session dir for `*.png` and would misread genfill assets as image nodes on session revive — it must skip `genfill-*` stems.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/services/test_session_assets.py`:

```python
from app.services import disk_session_io as dio


def test_asset_write_read_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.write_asset("s1", "genfill-w_1", b"PNGDATA")
    assert dio.read_asset("s1", "genfill-w_1") == b"PNGDATA"
    dio.delete_asset("s1", "genfill-w_1")
    assert dio.read_asset("s1", "genfill-w_1") is None
    dio.delete_asset("s1", "genfill-w_1")  # idempotent


def test_read_asset_missing_session(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    assert dio.read_asset("nope", "genfill-w_1") is None


def test_per_node_image_scan_skips_genfill_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    dio.save_session("s1", b"primary", "image/png", created_at=0.0)
    dio.write_image("s1", "in-extra", b"nodeimg", "image/png")
    dio.write_asset("s1", "genfill-w_1", b"asset")
    scanned = dio.read_per_node_images("s1")
    assert "in-extra" in scanned
    assert all(not k.startswith("genfill-") for k in scanned)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_session_assets.py -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'write_asset'`

- [ ] **Step 3: Implement**

In `backend/app/services/disk_session_io.py`, append:

```python
# ------------------------------------------------------------------
# Generated assets (genfill results). Stored as <asset_id>.png in the
# session dir. Asset ids are namespaced ("genfill-<widget_id>") so the
# per-node image scan can exclude them (see read_per_node_images).
# ------------------------------------------------------------------


def write_asset(sid: str, asset_id: str, data: bytes) -> None:
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{asset_id}.png").write_bytes(data)


def read_asset(sid: str, asset_id: str) -> bytes | None:
    p = _session_dir(sid) / f"{asset_id}.png"
    try:
        return p.read_bytes()
    except OSError:
        return None


def delete_asset(sid: str, asset_id: str) -> None:
    p = _session_dir(sid) / f"{asset_id}.png"
    try:
        p.unlink()
    except OSError:
        pass
```

In `read_per_node_images()`, after the `if stem == "image":` guard, add:

```python
        if stem.startswith("genfill-"):
            continue  # generated asset (write_asset), not an image node
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_session_assets.py -q`
Expected: 3 passed

- [ ] **Step 5: Add the GET route**

In `backend/app/api/session.py`, add (adapt imports/`router`/deps to the file's existing conventions — it already has session routes and a `router`):

```python
import re

from fastapi import HTTPException
from fastapi.responses import Response

from app.services import disk_session_io

_ASSET_ID_RE = re.compile(r"^genfill-[A-Za-z0-9_-]+$")


@router.get("/session/{sid}/assets/{asset_id}")
async def get_session_asset(sid: str, asset_id: str) -> Response:
    """Serve a generated asset (genfill result PNG). Asset ids are constrained
    to the genfill namespace — this is NOT a general file server."""
    if not _ASSET_ID_RE.fullmatch(asset_id):
        raise HTTPException(status_code=404, detail="unknown asset")
    data = disk_session_io.read_asset(sid, asset_id)
    if data is None:
        raise HTTPException(status_code=404, detail="unknown asset")
    return Response(content=data, media_type="image/png")
```

Note: check how other routes in `session.py` are declared (prefix may already include `/api` via `main.py` mounting — mirror the existing session upload route's path shape exactly so the final URL is `/api/session/{sid}/assets/{asset_id}`).

Add an API test in `backend/tests/api/test_session_assets_route.py` following the conventions of existing tests in `backend/tests/api/` (they use FastAPI's TestClient — mirror the fixture/bootstrapping of a neighboring test file):

```python
def test_asset_route_serves_png_and_404s(client, tmp_sessions_dir):
    # Arrange: write an asset directly via disk_session_io into the test sessions dir
    from app.services import disk_session_io as dio
    dio.write_asset("s1", "genfill-w_1", b"PNG")
    ok = client.get("/api/session/s1/assets/genfill-w_1")
    assert ok.status_code == 200
    assert ok.content == b"PNG"
    assert ok.headers["content-type"] == "image/png"
    assert client.get("/api/session/s1/assets/genfill-w_1/../escape").status_code in (404, 422)
    assert client.get("/api/session/s1/assets/other-w_1").status_code == 404
    assert client.get("/api/session/s1/assets/genfill-missing").status_code == 404
```

(Adapt `client` / sessions-dir fixtures to what `backend/tests/api/` actually provides; if no such fixtures exist, create the TestClient inline the way the nearest existing API test does, and monkeypatch `disk_session_io.SESSIONS_DIR` to `tmp_path`.)

- [ ] **Step 6: Run the API test**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/services/test_session_assets.py tests/api/test_session_assets_route.py -q`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/disk_session_io.py backend/app/api/session.py backend/tests/services/test_session_assets.py backend/tests/api/test_session_assets_route.py
git commit -m "feat(genfill): session asset storage + GET asset route (genfill-* namespace)"
```

---

### Task 4: Genfill backend tools (`genfill_create`, `genfill_regenerate`) + background generation

**Files:**
- Create: `backend/app/tools/widgets/genfill.py`
- Modify: `backend/app/tools/widgets/__init__.py` (register both tools)
- Modify: `backend/app/tools/registry.py` (public `store`/`bus` accessors — 6 lines)
- Test: `backend/tests/registry/test_genfill_tools.py` (if `backend/tests/registry/` doesn't hold tool-handler tests, place next to whatever tests other widget tools — check `grep -rln "ProposeStackTool\|AcceptWidgetTool" backend/tests`)

**Interfaces:**
- Consumes: `ReplicateClient.run_bria_genfill` (Task 1), `GenfillState/GenfillResultInfo/GenfillError` (Task 2), `disk_session_io.write_asset/delete_asset` (Task 3), `SessionDocument`: `doc.masks: dict[str, MaskRecord]`, `doc.get_image_bytes(image_node_id)`, `doc.get_mime_type(image_node_id)`, `doc.add_widget(w)`, `doc.update_widget(w)`, `doc.widgets: dict[str, Widget]`, `SessionStore.with_document_lock(sid)`, `store.checkpointer.mark_dirty(doc)`, `EventBus.publish(sid, ev)`.
- Produces: REST tools `genfill_create` (input `{imageNodeId, maskId, prompt='', negativePrompt?, seed?, origin}` → `{widgetId}`) and `genfill_regenerate` (input `{widgetId, prompt?, negativePrompt?, seed?}` → `{widgetId}`). Frontend (Task 6) calls these via `invokeTool`.
- Concurrency contract: the mutate handler creates/updates the widget and returns immediately; the Replicate call runs in an `asyncio` task that re-acquires the session lock only to read inputs and to write results, and publishes pending events itself (mirroring `BackendToolRegistry._flush_history_to_bus`). The lock is NEVER held across the network call.

- [ ] **Step 1: Add registry accessors**

In `backend/app/tools/registry.py`, inside `BackendToolRegistry` after `__init__`:

```python
    @property
    def store(self) -> SessionStore:
        """Session store, exposed for tools that schedule background work
        (genfill) and must re-acquire the document lock after their handler
        returned."""
        return self._store

    @property
    def bus(self) -> EventBus:
        return self._bus
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/registry/test_genfill_tools.py`:

```python
import asyncio
import base64

import pytest

from app.schemas.widget import MaskRecord
from app.services import disk_session_io as dio
from app.services.replicate_client import GenfillResult
from app.state.document import DEFAULT_IMAGE_NODE_ID
from app.tools.widgets.genfill import (
    GenfillCreateTool, GenfillRegenerateTool, _run_generation,
)

# 2x2 all-white PNG (any tiny valid PNG works; regenerate with PIL if needed):
#   from PIL import Image; import io, base64
#   b = io.BytesIO(); Image.new("L", (2, 2), 255).save(b, "PNG")
#   base64.b64encode(b.getvalue())
MASK_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAAC0lEQVR4nGP4/x8AAwMB/6oJTIcAAAAASUVORK5CYII="


def _add_mask(doc, mask_id="m1", w=2, h=2):
    doc.add_mask(MaskRecord(
        id=mask_id, width=w, height=h, png_b64=MASK_PNG_B64,
        source="sam_point", label="thing", image_node_id=DEFAULT_IMAGE_NODE_ID,
    ))


def _image_png_2x2() -> bytes:
    import io
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (2, 2), (10, 20, 30)).save(b, "PNG")
    return b.getvalue()


class _FakeReplicate:
    def __init__(self, result: GenfillResult):
        self.result = result
        self.calls: list[dict] = []

    async def run_bria_genfill(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class _FakeLockCtx:
    def __init__(self, doc):
        self.doc = doc
    async def __aenter__(self):
        return self.doc
    async def __aexit__(self, *a):
        return False


class _FakeStore:
    def __init__(self, doc):
        self.doc = doc
        self.dirty = []
        class _Ckpt:
            def mark_dirty(inner, d):
                self.dirty.append(d)
        self.checkpointer = _Ckpt()
    def with_document_lock(self, sid):
        return _FakeLockCtx(self.doc)


class _FakeBus:
    def __init__(self):
        self.published = []
    def publish(self, sid, ev):
        self.published.append((sid, ev))


def _make_tool(doc, result=None):
    store = _FakeStore(doc)
    bus = _FakeBus()
    rep = _FakeReplicate(result or GenfillResult(ok=True, image_bytes=_image_png_2x2(), seed=42))
    tool = GenfillCreateTool(store=store, bus=bus, replicate=rep)
    scheduled: list[tuple[str, str]] = []
    tool._schedule = lambda sid, wid: scheduled.append((sid, wid))  # no real task
    return tool, store, bus, rep, scheduled


def test_create_compose_widget_empty_prompt(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    tool, _, _, _, scheduled = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "",
         "origin": "tool_invoked"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "compose"
    assert w.nodes == [] and w.bindings == []
    assert scheduled == []  # no generation for compose


def test_create_generating_widget_schedules_task(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    tool, _, _, _, scheduled = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "a boat",
         "origin": "mcp_user_prompt"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "generating"
    assert w.genfill.prompt == "a boat"
    assert w.genfill.seed > 0
    assert scheduled == [(doc.session_id, out.widget_id)]


def test_create_unknown_mask_raises(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    tool, *_ = _make_tool(doc)
    with pytest.raises(KeyError):
        asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
            {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "nope", "prompt": "x",
             "origin": "tool_invoked"})))


def test_create_aspect_mismatch_raises(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc, w=4, h=2)  # 2:1 mask vs 1:1 image
    tool, *_ = _make_tool(doc)
    with pytest.raises(Exception) as exc_info:
        asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
            {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
             "origin": "tool_invoked"})))
    assert exc_info.value.__class__.__name__ == "_InvalidInput"


def test_run_generation_success_writes_asset_and_updates_widget(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    tool, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "a boat",
         "origin": "tool_invoked"})))
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "ready"
    assert w.genfill.result.asset_id == f"genfill-{out.widget_id}"
    assert w.genfill.result.width == 2 and w.genfill.result.height == 2
    assert dio.read_asset(doc.session_id, f"genfill-{out.widget_id}") is not None
    # mask sent to replicate was converted to a binary L-mode PNG
    assert rep.calls and rep.calls[0]["prompt"] == "a boat"
    # widget.updated published + doc marked dirty
    assert any(ev.kind == "widget.updated" for _, ev in bus.published)
    assert store.dirty


def test_run_generation_error_sets_error_state(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    fail = GenfillResult(ok=False, image_bytes=None, seed=1,
                         error_kind="moderation", error_message="blocked")
    tool, store, bus, rep, _ = _make_tool(doc, result=fail)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
         "origin": "tool_invoked"})))
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "error"
    assert w.genfill.error.kind == "moderation"


def test_run_generation_widget_dismissed_midflight_is_noop(make_doc, tmp_path, monkeypatch):
    monkeypatch.setattr(dio, "SESSIONS_DIR", tmp_path)
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    tool, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(tool.handler(doc, tool.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "x",
         "origin": "tool_invoked"})))
    del doc.widgets[out.widget_id]  # simulate hard-deleted widget
    asyncio.run(_run_generation(store, bus, rep, doc.session_id, out.widget_id))
    assert dio.read_asset(doc.session_id, f"genfill-{out.widget_id}") is None


def test_regenerate_requires_prompt_and_rerolls_seed(make_doc):
    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _image_png_2x2(), mime_type="image/png")
    _add_mask(doc)
    create, store, bus, rep, _ = _make_tool(doc)
    out = asyncio.run(create.handler(doc, create.input_schema.model_validate(
        {"imageNodeId": DEFAULT_IMAGE_NODE_ID, "maskId": "m1", "prompt": "",
         "origin": "tool_invoked"})))
    regen = GenfillRegenerateTool(store=store, bus=bus, replicate=rep)
    scheduled = []
    regen._schedule = lambda sid, wid: scheduled.append((sid, wid))
    # empty effective prompt → _InvalidInput
    with pytest.raises(Exception) as exc_info:
        asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
            {"widgetId": out.widget_id})))
    assert exc_info.value.__class__.__name__ == "_InvalidInput"
    # with prompt → generating, seed set, scheduled
    asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
        {"widgetId": out.widget_id, "prompt": "a boat"})))
    w = doc.widgets[out.widget_id]
    assert w.genfill.status == "generating" and w.genfill.prompt == "a boat"
    first_seed = w.genfill.seed
    assert scheduled == [(doc.session_id, out.widget_id)]
    # regenerate without explicit seed → new seed; with explicit seed → kept
    asyncio.run(regen.handler(doc, regen.input_schema.model_validate(
        {"widgetId": out.widget_id, "seed": first_seed})))
    assert doc.widgets[out.widget_id].genfill.seed == first_seed
```

Note: if `doc.add_mask` doesn't exist with that name, check `backend/app/state/document.py` (propose_mask calls `doc.add_mask(record)` — it exists).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/registry/test_genfill_tools.py -q`
Expected: FAIL — `ModuleNotFoundError: app.tools.widgets.genfill`

- [ ] **Step 4: Implement the tools**

Create `backend/app/tools/widgets/genfill.py`:

```python
"""Generative-fill tools — Replicate bria/genfill.

genfill_create: mint a genfill widget (compose when the prompt is empty,
generating otherwise) and return immediately; the Replicate call runs as an
asyncio background task so the session write lock is never held across the
network round-trip (5–60 s). genfill_regenerate: re-run generation on an
existing genfill widget with an updated prompt/negative_prompt/seed.

Spec: docs/superpowers/specs/2026-07-02-genfill-widget-design.md
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import secrets
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.schemas.widget import (
    GenfillError, GenfillResultInfo, GenfillState, Scope, Widget,
    WidgetOrigin, WidgetPreview,
)
from app.services import disk_session_io
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions

try:
    from PIL import Image as _PILImage
    _PIL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PIL_AVAILABLE = False

logger = logging.getLogger(__name__)


class _UnknownWidget(KeyError):
    pass


class _UnknownMask(KeyError):
    pass


class _InvalidInput(Exception):
    pass


def _random_seed() -> int:
    return secrets.randbelow(2**31 - 1) + 1


def _png_dims(data: bytes) -> tuple[int, int]:
    img = _PILImage.open(io.BytesIO(data))
    return img.size


def _binary_mask_png(mask_png: bytes) -> bytes:
    """Convert a stored mask PNG (alpha-carried or grayscale) into the strict
    binary black/white L-mode PNG that Bria expects (white=255 → generate)."""
    img = _PILImage.open(io.BytesIO(mask_png))
    channel = img.getchannel("A") if "A" in img.getbands() else img.convert("L")
    binary = channel.point(lambda v: 255 if v >= 128 else 0)
    out = io.BytesIO()
    binary.save(out, format="PNG")
    return out.getvalue()


def _assert_aspect_match(doc: SessionDocument, image_node_id: str, mask) -> None:
    iw, ih = _png_dims(doc.get_image_bytes(image_node_id))
    if ih == 0 or mask.height == 0:
        raise _InvalidInput("genfill: degenerate image or mask dimensions")
    if abs((iw / ih) - (mask.width / mask.height)) > 0.02:
        raise _InvalidInput(
            f"genfill: mask aspect ratio {mask.width}x{mask.height} does not "
            f"match image {iw}x{ih}"
        )


def _publish_pending(doc: SessionDocument, bus, session_id: str) -> None:
    """Mirror BackendToolRegistry._flush_history_to_bus for the background
    task path: publish exactly the not-yet-published events and advance the
    cursor so the next registry flush doesn't re-publish them."""
    for ev in doc.history[doc._published_idx:]:
        bus.publish(session_id, ev)
    doc._published_idx = len(doc.history)


async def _run_generation(store, bus, replicate, session_id: str, widget_id: str) -> None:
    """Background half of genfill: read inputs under the lock, call Replicate
    WITHOUT the lock, write results under the lock."""
    async with store.with_document_lock(session_id) as doc:
        w = doc.widgets.get(widget_id)
        if w is None or w.genfill is None:
            return
        g = w.genfill
        image_bytes = doc.get_image_bytes(g.image_node_id)
        image_mime = doc.get_mime_type(g.image_node_id)
        mask = doc.masks.get(g.mask_id)
        if mask is None:
            return
        mask_png = _binary_mask_png(base64.b64decode(mask.png_b64))
        prompt, negative, seed = g.prompt, g.negative_prompt, g.seed

    result = await replicate.run_bria_genfill(
        image_bytes=image_bytes, image_mime=image_mime, mask_png=mask_png,
        prompt=prompt, negative_prompt=negative, seed=seed,
    )

    async with store.with_document_lock(session_id) as doc:
        w = doc.widgets.get(widget_id)
        if w is None or w.genfill is None:
            return  # dismissed while generating — drop the result
        if result.ok and result.image_bytes:
            asset_id = f"genfill-{widget_id}"
            disk_session_io.write_asset(session_id, asset_id, result.image_bytes)
            width, height = _png_dims(result.image_bytes)
            w.genfill = w.genfill.model_copy(update={
                "status": "ready",
                "result": GenfillResultInfo(asset_id=asset_id, width=width, height=height),
                "error": None,
                "seed": result.seed,
            })
        else:
            w.genfill = w.genfill.model_copy(update={
                "status": "error",
                "error": GenfillError(
                    kind=result.error_kind or "api_error",
                    message=result.error_message or "generation failed",
                ),
            })
        doc.update_widget(w)
        _publish_pending(doc, bus, session_id)
        store.checkpointer.mark_dirty(doc)


class _GenfillToolBase:
    """Shared constructor + scheduler for the two genfill tools. Instances are
    constructed WITH deps (store/bus/replicate) in register_all_widget_tools —
    unlike other widget tools they schedule work outside the handler."""

    def __init__(self, *, store, bus, replicate) -> None:
        self._store = store
        self._bus = bus
        self._replicate = replicate

    def _schedule(self, session_id: str, widget_id: str) -> None:
        task = asyncio.create_task(
            _run_generation(self._store, self._bus, self._replicate, session_id, widget_id),
            name=f"genfill:{widget_id}",
        )
        task.add_done_callback(_log_task_exception)


def _log_task_exception(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.exception("genfill background task failed", exc_info=exc)


class _CreateInput(BaseModel):
    model_config = camel_config(extra="forbid")
    image_node_id: str = Field(min_length=1)
    mask_id: str = Field(min_length=1)
    prompt: str = ""
    negative_prompt: str | None = None
    seed: int | None = None
    origin: Literal["tool_invoked", "mcp_user_prompt"] = "tool_invoked"


class _CreateOutput(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str


class GenfillCreateTool(_GenfillToolBase, BackendTool[_CreateInput, _CreateOutput]):
    name = "genfill_create"
    kind = "mutate"
    description = (
        "Create a generative-fill widget targeting a mask. Empty prompt = "
        "compose state (no generation); non-empty prompt starts generation "
        "in the background (status flows via SSE widget.updated)."
    )
    input_schema = _CreateInput
    output_schema = _CreateOutput
    permissions = ToolPermissions(requires_image=True, requires_context=False)
    is_user_action = True

    def history_label(self, input: _CreateInput, output: _CreateOutput) -> str:  # noqa: A002
        return "Generative fill"

    async def handler(self, doc: SessionDocument, input: _CreateInput) -> _CreateOutput:  # noqa: A002
        mask = doc.masks.get(input.mask_id)
        if mask is None:
            raise _UnknownMask(input.mask_id)
        _assert_aspect_match(doc, input.image_node_id, mask)

        prompt = input.prompt.strip()
        widget_id = f"w_gf_{uuid.uuid4().hex[:8]}"
        widget = Widget(
            id=widget_id,
            intent=prompt or "Generative fill",
            scope=Scope.model_validate({"kind": "mask", "maskId": input.mask_id}),
            origin=WidgetOrigin(kind=input.origin, prompt=prompt or None,
                                anchor=f"mask:{input.mask_id}"),
            preview=WidgetPreview(kind="none", auto_before_after=False),
            genfill=GenfillState(
                status="generating" if prompt else "compose",
                prompt=prompt,
                negative_prompt=input.negative_prompt,
                seed=input.seed if input.seed is not None else _random_seed(),
                mask_id=input.mask_id,
                image_node_id=input.image_node_id,
            ),
        )
        doc.add_widget(widget)
        if prompt:
            self._schedule(doc.session_id, widget_id)
        return _CreateOutput(widget_id=widget_id)


class _RegenInput(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_id: str = Field(min_length=1)
    prompt: str | None = None
    negative_prompt: str | None = None
    seed: int | None = None


class GenfillRegenerateTool(_GenfillToolBase, BackendTool[_RegenInput, _CreateOutput]):
    name = "genfill_regenerate"
    kind = "mutate"
    description = (
        "(Re-)run generation on an existing genfill widget. Omitted prompt "
        "keeps the stored one (must be non-empty); omitted seed rolls a new one."
    )
    input_schema = _RegenInput
    output_schema = _CreateOutput
    permissions = ToolPermissions(requires_image=True, requires_context=False)
    is_user_action = True

    def history_label(self, input: _RegenInput, output: _CreateOutput) -> str:  # noqa: A002
        return "Generative fill (regenerate)"

    async def handler(self, doc: SessionDocument, input: _RegenInput) -> _CreateOutput:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None or w.genfill is None:
            raise _UnknownWidget(input.widget_id)
        if w.genfill.status == "generating":
            raise _InvalidInput("genfill: generation already in progress")
        prompt = (input.prompt if input.prompt is not None else w.genfill.prompt).strip()
        if not prompt:
            raise _InvalidInput("genfill: prompt must not be empty")
        negative = (input.negative_prompt if input.negative_prompt is not None
                    else w.genfill.negative_prompt)
        seed = input.seed if input.seed is not None else _random_seed()
        w.genfill = w.genfill.model_copy(update={
            "status": "generating", "prompt": prompt,
            "negative_prompt": negative, "seed": seed, "error": None,
        })
        w.intent = prompt
        doc.update_widget(w)
        self._schedule(doc.session_id, input.widget_id)
        return _CreateOutput(widget_id=input.widget_id)
```

Note on `Scope.model_validate({"kind": "mask", "maskId": ...})`: `camel_config` accepts camelCase aliases. If the schema test from Task 2 used `maskId` successfully, keep it; if `Scope` validation requires snake_case there, use `{"kind": "mask", "mask_id": ...}` — match whatever Task 2's passing test used.

- [ ] **Step 5: Register the tools**

In `backend/app/tools/widgets/__init__.py`:

```python
from app.config import get_settings
from app.services.replicate_client import ReplicateClient

from .genfill import GenfillCreateTool, GenfillRegenerateTool
```

(`from app.config import get_settings` — verify this import path against `deps.py`'s `from app.config import get_settings`; it's the same.)

And in `register_all_widget_tools`, at the end:

```python
    replicate = ReplicateClient(api_token=get_settings().replicate_api_token)
    registry.register(GenfillCreateTool(
        store=registry.store, bus=registry.bus, replicate=replicate))
    registry.register(GenfillRegenerateTool(
        store=registry.store, bus=registry.bus, replicate=replicate))
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/registry/test_genfill_tools.py -q`
Expected: 8 passed

Then the full backend suite to catch registration fallout (some tests may call `register_all_widget_tools` and now need `get_settings()` to resolve — it reads `.env` with defaults, `replicate_api_token` defaults to `""`, so this should be safe):

Run: `cd backend && source .venv/bin/activate && python -m pytest tests -q`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add backend/app/tools/widgets/genfill.py backend/app/tools/widgets/__init__.py backend/app/tools/registry.py backend/tests/registry/test_genfill_tools.py
git commit -m "feat(genfill): genfill_create/genfill_regenerate tools with background Replicate generation"
```

---

### Task 5: Frontend backend-tools + spawn funnel (`genfill-spawn.ts`)

**Files:**
- Modify: `src/lib/backend-tools.ts` (two exports)
- Create: `src/lib/genfill-spawn.ts`
- Test: `src/lib/genfill-spawn.test.ts`

**Interfaces:**
- Consumes: `invokeTool` pattern in `backend-tools.ts`; `useAiSession.getState().sessionId`; `useBackendState.getState().sseStatus`; `maskStore` (`@/core/mask-store`); `pixelStore` (`@/core/pixel-store`); `backendTools.propose_mask` (exists); `maskToPngBase64` (exists — locate with `grep -rn "maskToPngBase64" src/`, import from its module).
- Produces: `spawnGenfillFromMask(maskId: string, imageNodeId: string): Promise<string | null>` (returns widgetId or null), `spawnGenfillFromLayer(layerId: string, imageNodeId: string): Promise<string | null>`. Tasks 7–9 call these. Also `backendTools.genfill_create` / `backendTools.genfill_regenerate`.

- [ ] **Step 1: Add the tool wrappers**

In `src/lib/backend-tools.ts`, next to `propose_mask`:

```typescript
  genfill_create(sessionId: string, args: {
    imageNodeId: string;
    maskId: string;
    prompt: string;
    negativePrompt?: string;
    seed?: number;
    origin: 'tool_invoked' | 'mcp_user_prompt';
  }) {
    return invokeTool<{ widgetId: string }>('genfill_create', sessionId, args);
  },

  genfill_regenerate(sessionId: string, args: {
    widgetId: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
  }) {
    return invokeTool<{ widgetId: string }>('genfill_regenerate', sessionId, args);
  },
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/genfill-spawn.test.ts` (mirror the mocking style of an existing lib test — check `src/lib/*.test.ts` for the closest pattern):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { spawnGenfillFromMask } from './genfill-spawn';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    genfill_create: vi.fn(async () => ({ ok: true, output: { widgetId: 'w_gf_1' } })),
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'm_new' } })),
  },
}));

describe('spawnGenfillFromMask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiSession.setState({ sessionId: 's1' });
    useBackendState.setState({ sseStatus: 'open' });
  });

  it('calls genfill_create with the mask and empty prompt (compose)', async () => {
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBe('w_gf_1');
    expect(backendTools.genfill_create).toHaveBeenCalledWith('s1', {
      imageNodeId: 'in-default',
      maskId: 'm1',
      prompt: '',
      origin: 'tool_invoked',
    });
  });

  it('refuses when SSE is not open', async () => {
    useBackendState.setState({ sseStatus: 'closed' });
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBeNull();
    expect(backendTools.genfill_create).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    useAiSession.setState({ sessionId: null });
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBeNull();
  });
});
```

Adapt the `useAiSession` / `useBackendState` setState shapes to their real state slices (check how `backend-state-slice.test.ts` sets `sseStatus`; if `useAiSession` isn't a plain zustand store settable this way, mock the module instead like other tests do).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/genfill-spawn.test.ts`
Expected: FAIL — cannot resolve `./genfill-spawn`

- [ ] **Step 4: Implement the spawn funnel**

Create `src/lib/genfill-spawn.ts`:

```typescript
/** Genfill spawn funnel — every entry point (context menus, Cmd+K) resolves
 *  its source to a maskId and lands here. Spec:
 *  docs/superpowers/specs/2026-07-02-genfill-widget-design.md */
import { toast } from 'sonner';
import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { useAiSession } from '@/hooks/useImageContext';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
// maskToPngBase64: import from the module that candidate-actions.ts imports it
// from (grep maskToPngBase64) — do NOT reimplement it.
import { maskToPngBase64 } from '@/lib/segmentation/mask-utils';

function requireSession(): string | null {
  if (useBackendState.getState().sseStatus !== 'open') {
    toast.info('Backend disconnected — generative fill unavailable.');
    return null;
  }
  const sessionId = useAiSession.getState().sessionId;
  if (!sessionId) {
    toast.info('Backend session not ready.');
    return null;
  }
  return sessionId;
}

/** Spawn a genfill widget (compose state) targeting an existing mask. */
export async function spawnGenfillFromMask(
  maskId: string,
  imageNodeId: string,
  prompt = '',
  origin: 'tool_invoked' | 'mcp_user_prompt' = 'tool_invoked',
): Promise<string | null> {
  const sessionId = requireSession();
  if (!sessionId) return null;
  const env = await backendTools.genfill_create(sessionId, {
    imageNodeId,
    maskId,
    prompt,
    origin,
  });
  if (!env.ok) {
    toast.info(`Generative fill failed: ${env.error?.message ?? 'unknown error'}`);
    return null;
  }
  return env.output?.widgetId ?? null;
}

/** Spawn genfill for an object layer: use its layerMask if present, else
 *  rasterize the layer's alpha channel into a new registered mask. */
export async function spawnGenfillFromLayer(
  layerId: string,
  imageNodeId: string,
): Promise<string | null> {
  const sessionId = requireSession();
  if (!sessionId) return null;
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === layerId);
  if (!layer) return null;

  if (layer.layerMask && maskStore.get(layer.layerMask)) {
    return spawnGenfillFromMask(layer.layerMask, imageNodeId);
  }

  const maskId = await registerLayerAlphaMask(sessionId, layerId, imageNodeId);
  if (!maskId) return null;
  return spawnGenfillFromMask(maskId, imageNodeId);
}

/** Rasterize a layer's alpha channel (alpha ≥ 128 → 255) into a mask and
 *  register it via propose_mask. Returns the new maskId or null. */
async function registerLayerAlphaMask(
  sessionId: string,
  layerId: string,
  imageNodeId: string,
): Promise<string | null> {
  const canvas = pixelStore.get(layerId);
  if (!canvas) {
    toast.info('Generative fill: layer has no pixel data.');
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    data[i] = img.data[i * 4 + 3] >= 128 ? 255 : 0;
  }
  const pngBase64 = await maskToPngBase64({ width, height, data });
  const editor = useEditorStore.getState();
  const layerName = editor.layers.find((l) => l.id === layerId)?.name ?? 'layer';
  const env = await backendTools.propose_mask(sessionId, {
    imageNodeId,
    pngBase64,
    paths: [],
    label: `${layerName} footprint`,
    origin: 'client_new',
  });
  if (!env.ok || !env.output?.maskId) {
    toast.info(`Generative fill: could not register mask — ${env.error?.message ?? 'unknown error'}`);
    return null;
  }
  const maskId = env.output.maskId;
  maskStore.injectWithId({
    id: maskId,
    layerId,
    label: `${layerName} footprint`,
    width,
    height,
    data,
    source: 'brush',
    createdAt: Date.now(),
  });
  return maskId;
}
```

Adapt: the `maskToPngBase64` import path and argument shape must match the real helper (see its use in `src/lib/segmentation/candidate-actions.ts` — it takes `sel.mask` which is `{width, height, data}`); the `pixelStore.get` accessor name (check `src/core/pixel-store.ts` — it may be `get`/`getSource`/`getWorking`); `maskStore.injectWithId` shape is confirmed by candidate-actions.ts; `MaskSource` value `'brush'` must exist in `src/core/mask-store.ts`'s `MaskSource` union (candidate-actions uses `'sam-point'`/`'sam-points'` — pick an existing value, `'brush'` if present, else `'ai-proposed'`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/genfill-spawn.test.ts`
Expected: 3 passed

- [ ] **Step 6: Commit**

```bash
git add src/lib/backend-tools.ts src/lib/genfill-spawn.ts src/lib/genfill-spawn.test.ts
git commit -m "feat(genfill): frontend tool wrappers + spawn funnel with layer-alpha mask registration"
```

---

### Task 6: Accept/Discard actions (`genfill-actions.ts`) — clip + new layer

**Files:**
- Create: `src/store/genfill-actions.ts`
- Create: `src/lib/genfill-asset.ts` (asset URL helper)
- Test: `src/store/genfill-actions.test.ts`

**Interfaces:**
- Consumes: `Widget.genfill` (Task 2), asset route (Task 3), `maskStore`, `pixelStore`, `putSource`-style persist (mirror `segment-actions.ts` imports exactly), `editorDocument.workspace.batch(label, fn)` (undoable wrapper), `backendTools.accept_widget` / `dismiss_widget` (check the exact dismiss wrapper name in `backend-tools.ts` — `delete_widget`/`dismiss_widget`).
- Produces: `acceptGenfill(widgetId: string, opts: { clip: boolean }): Promise<string | null>` (new layer id), `discardGenfill(widgetId: string): Promise<void>`, `genfillAssetUrl(sessionId: string, assetId: string): string`. Task 7's widget body calls all three.

- [ ] **Step 1: Asset URL helper**

Create `src/lib/genfill-asset.ts`:

```typescript
import { BACKEND_BASE_URL, getBackendToken } from '@/lib/backend-url';

/** URL for a genfill result asset. Appends the shared-secret token as a query
 *  param when configured (same convention as the header-less SSE stream —
 *  <img>/fetch GETs can't carry the Authorization header everywhere). */
export function genfillAssetUrl(sessionId: string, assetId: string): string {
  const base = `${BACKEND_BASE_URL}/api/session/${sessionId}/assets/${assetId}`;
  const token = getBackendToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/store/genfill-actions.test.ts`. Mirror the setup style of `src/store/backend-state-slice.test.ts` (vitest, `fake-indexeddb/auto`, snapshot factory). Mock `fetch` + `createImageBitmap`; OffscreenCanvas exists in the vitest environment used by segment-actions-adjacent tests — if not, check how existing canvas-touching tests handle it (jsdom may need a shim; follow whatever `segment-actions` tests do; if segment-actions has no tests, exercise only the pure mask-compositing helper and the store bookkeeping, and factor the canvas work into an injectable function):

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { acceptGenfill, discardGenfill, __clipCanvasWithMask } from './genfill-actions';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    accept_widget: vi.fn(async () => ({ ok: true, output: { widgetId: 'w_gf_1' } })),
    delete_widget: vi.fn(async () => ({ ok: true, output: {} })),
  },
}));

// __clipCanvasWithMask(canvas, mask): pure — alpha outside mask becomes 0.
describe('__clipCanvasWithMask', () => {
  it('zeroes alpha outside the mask and keeps it inside', () => {
    const canvas = new OffscreenCanvas(2, 1);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 2, 1);
    // mask: left px in, right px out
    __clipCanvasWithMask(canvas, { width: 2, height: 1, data: new Uint8Array([255, 0]) });
    const out = ctx.getImageData(0, 0, 2, 1).data;
    expect(out[3]).toBe(255);  // left alpha kept
    expect(out[7]).toBe(0);    // right alpha cleared
  });
});

describe('acceptGenfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Seed a ready genfill widget in the snapshot + a mask in maskStore +
    // a source layer. Mirror baseSnapshot()/makeWidget() from
    // backend-state-slice.test.ts, with:
    //   widget.genfill = { status: 'ready', prompt: 'a boat', seed: 1,
    //     maskId: 'm1', imageNodeId: 'in-default',
    //     result: { assetId: 'genfill-w_gf_1', width: 2, height: 1 } }
    // and stub global.fetch to return a 2x1 PNG blob, plus
    // global.createImageBitmap to decode it (or return a fake with
    // width/height + drawable — see how other canvas tests fake bitmaps).
  });

  it('creates a new layer, registered in pixelStore, and accepts the widget', async () => {
    const layerId = await acceptGenfill('w_gf_1', { clip: false });
    expect(layerId).not.toBeNull();
    const editor = useEditorStore.getState();
    const layer = editor.layers.find((l) => l.id === layerId);
    expect(layer?.type).toBe('genfill');
    expect(layer?.name).toBe('Genfill: a boat');
    expect(backendTools.accept_widget).toHaveBeenCalledWith('s1', { widgetId: 'w_gf_1' });
  });

  it('returns null when the widget is not ready', async () => {
    // seed widget with status 'generating'
    const layerId = await acceptGenfill('w_gf_1', { clip: true });
    expect(layerId).toBeNull();
  });
});
```

Flesh out the `beforeEach` seeding with the real store shapes (this is deliberate: copy `makeWidget`/`baseSnapshot` from `backend-state-slice.test.ts` and extend). If OffscreenCanvas is unavailable in the vitest environment, add the same setup/polyfill other canvas tests use — and if none exists, split: unit-test `__clipCanvasWithMask` behind a `typeof OffscreenCanvas !== 'undefined'` skip and test the rest via mocked canvas.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/store/genfill-actions.test.ts`
Expected: FAIL — cannot resolve `./genfill-actions`

- [ ] **Step 4: Implement**

Create `src/store/genfill-actions.ts` (mirror `segment-actions.ts` imports — same `pixelStore` / persist-source / `maskStore` modules):

```typescript
/** Accept/Discard for genfill widgets. Accept fetches the result asset,
 *  optionally clips it by the SAME mask that was sent to Bria, and lands the
 *  pixels on a NEW layer (never mutating the original). Spec:
 *  docs/superpowers/specs/2026-07-02-genfill-widget-design.md */
import { toast } from 'sonner';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { maskStore } from '@/core/mask-store';
import { pixelStore } from '@/core/pixel-store';
import { backendTools } from '@/lib/backend-tools';
import { editorDocument } from '@/core/document';
import { genfillAssetUrl } from '@/lib/genfill-asset';
// Persist helper: import EXACTLY what segment-actions.ts imports for IDB
// persistence of new layer sources (putSource / persistCanvasSource — copy
// the import line and the call shape from extractLayerFromMask).
import { putSource } from '@/core/pixel-source-store';

interface MaskBitmapLike {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Zero out alpha outside the mask (destination-in composite with a
 *  white-on-transparent mask canvas, scaled to the target). Exported for
 *  tests only. */
export function __clipCanvasWithMask(canvas: OffscreenCanvas, mask: MaskBitmapLike): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('genfill clip: unable to acquire 2D context');
  const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) throw new Error('genfill clip: unable to acquire mask 2D context');
  const maskImg = maskCtx.createImageData(mask.width, mask.height);
  const md = maskImg.data;
  for (let i = 0; i < mask.data.length; i++) {
    const j = i * 4;
    md[j] = 255;
    md[j + 1] = 255;
    md[j + 2] = 255;
    md[j + 3] = mask.data[i];
  }
  maskCtx.putImageData(maskImg, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export async function acceptGenfill(
  widgetId: string,
  opts: { clip: boolean },
): Promise<string | null> {
  const backend = useBackendState.getState();
  const snapshot = backend.snapshot;
  const widget = snapshot?.widgets.find((w) => w.id === widgetId);
  const g = widget?.genfill;
  if (!snapshot || !g || g.status !== 'ready' || !g.result) return null;

  const url = genfillAssetUrl(snapshot.sessionId, g.result.assetId);
  let bitmap: ImageBitmap;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`asset fetch → ${resp.status}`);
    bitmap = await createImageBitmap(await resp.blob());
  } catch (err) {
    toast.info(`Generative fill: could not load result — ${String(err)}`);
    return null;
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);

  if (opts.clip) {
    const mask = maskStore.get(g.maskId);
    if (mask) {
      __clipCanvasWithMask(canvas, mask);
    } else {
      toast.info('Generative fill: mask no longer exists — placing full image.');
    }
  }

  const newId = crypto.randomUUID();
  pixelStore.register(newId, canvas);
  putSource(snapshot.sessionId, newId, canvas); // adapt to the real persist call in segment-actions.ts

  editorDocument.workspace.batch('Genfill layer', () => {
    const editor = useEditorStore.getState();
    editor.addLayer({
      id: newId,
      type: 'genfill',
      name: `Genfill: ${truncate(g.prompt, 32)}`,
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      locked: false,
    });
    editor.setActiveLayer(newId);
  });

  const env = await backendTools.accept_widget(snapshot.sessionId, { widgetId });
  if (!env.ok) {
    toast.info(`Generative fill: accept failed — ${env.error?.message ?? 'unknown'}`);
  }
  return newId;
}

export async function discardGenfill(widgetId: string): Promise<void> {
  const sessionId = useBackendState.getState().snapshot?.sessionId;
  if (!sessionId) return;
  const env = await backendTools.delete_widget(sessionId, { widgetId });
  if (!env.ok) {
    toast.info(`Generative fill: discard failed — ${env.error?.message ?? 'unknown'}`);
  }
}
```

Adapt: the persist call (`putSource` vs `persistCanvasSource(newId, canvas)`) and dismiss wrapper (`delete_widget` vs `dismiss_widget`) to the real names — copy from `segment-actions.ts` and `backend-tools.ts`. If `'genfill'` as a `LayerType` breaks anything downstream (it's `string`-typed by design, so it shouldn't), fall back to `'image'` and note it. Backend note: `delete_widget`/dismiss does NOT yet delete the asset — add asset cleanup to the backend `delete_widget` tool in this task if trivial (call `disk_session_io.delete_asset(doc.session_id, f"genfill-{widget_id}")` when the widget has a genfill block), otherwise log it as a follow-up in the commit message; assets die with the session dir regardless.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/store/genfill-actions.test.ts`
Expected: PASS

- [ ] **Step 6: Backend dismiss cleanup (small)**

In `backend/app/tools/widgets/delete_widget.py` (the dismiss tool), after the widget is resolved and before/after `doc.dismiss_widget(...)` (fit the existing flow), add:

```python
        w = doc.widgets.get(input.widget_id)
        if w is not None and w.genfill is not None:
            from app.services import disk_session_io
            disk_session_io.delete_asset(doc.session_id, f"genfill-{input.widget_id}")
```

Add one assertion to `backend/tests/registry/test_genfill_tools.py` if a delete-widget test fixture is straightforward; otherwise verify manually that dismissing a genfill widget removes `genfill-<id>.png`.

- [ ] **Step 7: Run both suites, commit**

Run: `npx vitest run && cd backend && source .venv/bin/activate && python -m pytest tests -q`
Expected: all pass

```bash
git add src/store/genfill-actions.ts src/store/genfill-actions.test.ts src/lib/genfill-asset.ts backend/app/tools/widgets/delete_widget.py
git commit -m "feat(genfill): accept/discard actions — client-side mask clip onto a new layer"
```

---

### Task 7: `GenfillWidgetBody` + WidgetShell integration

**Files:**
- Create: `src/components/widget/GenfillWidgetBody.tsx`
- Modify: `src/components/widget/WidgetShell.tsx` (body switch + suppress default footer for genfill)
- Test: `src/components/widget/GenfillWidgetBody.test.tsx`

**Interfaces:**
- Consumes: `Widget.genfill` (Task 2), `backendTools.genfill_regenerate` (Task 5), `acceptGenfill`/`discardGenfill`/`genfillAssetUrl` (Task 6), `maskStore`, `pixelStore`, `useEditorStore` (image node dims), design tokens/`ui/` primitives (Button-like styles: reuse existing widget footer button classes — look at how RefineInput's Send button and any Accept affordances are styled).
- Produces: `<GenfillWidgetBody widget={widget} />` — self-contained body covering compose / generating / ready / error states, prompt + negative prompt fields, seed readout + pin, Regenerate, preview `<img>`, clip toggle, Accept/Discard footer.

- [ ] **Step 1: Write the failing component test**

Create `src/components/widget/GenfillWidgetBody.test.tsx` (mirror the repo's component-test conventions — see `src/components/workspace/drafting/LayerStrip.test.tsx` for the rendering setup):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenfillWidgetBody } from './GenfillWidgetBody';
import type { Widget, GenfillState } from '@/types/widget';

vi.mock('@/store/genfill-actions', () => ({
  acceptGenfill: vi.fn(),
  discardGenfill: vi.fn(),
}));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { genfill_regenerate: vi.fn(async () => ({ ok: true })) },
}));

function widgetWith(genfill: Partial<GenfillState>): Widget {
  return {
    id: 'w_gf_1', intent: 'Generative fill', scope: { kind: 'mask', mask_id: 'm1' },
    origin: { kind: 'tool_invoked' }, composed: false, nodes: [], bindings: [],
    preview: { kind: 'none', auto_before_after: false }, rejectedAttempts: [],
    status: 'active', revision: 1, lockedParams: [],
    createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
    genfill: {
      status: 'compose', prompt: '', seed: 7, maskId: 'm1',
      imageNodeId: 'in-default', ...genfill,
    },
  } as Widget;
}

describe('GenfillWidgetBody', () => {
  it('compose state renders prompt input and Generate button', () => {
    render(<GenfillWidgetBody widget={widgetWith({ status: 'compose' })} />);
    expect(screen.getByPlaceholderText(/describe what to generate/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate/i })).toBeTruthy();
  });

  it('generating state disables controls and shows skeleton', () => {
    render(<GenfillWidgetBody widget={widgetWith({ status: 'generating', prompt: 'a boat' })} />);
    expect(screen.getByTestId('genfill-skeleton')).toBeTruthy();
    expect((screen.getByRole('button', { name: /regenerate/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ready state shows preview, clip toggle, Accept and Discard', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'ready', prompt: 'a boat',
      result: { assetId: 'genfill-w_gf_1', width: 100, height: 50 },
    })} />);
    expect(screen.getByRole('img')).toBeTruthy();
    expect(screen.getByLabelText(/clip to region/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /discard/i })).toBeTruthy();
  });

  it('error state shows message and Retry', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'error', prompt: 'x',
      error: { kind: 'moderation', message: 'blocked' },
    })} />);
    expect(screen.getByText(/blocked/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('not_configured error hides Retry', () => {
    render(<GenfillWidgetBody widget={widgetWith({
      status: 'error', prompt: 'x',
      error: { kind: 'not_configured', message: 'Replicate not configured' },
    })} />);
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
```

(If `@testing-library/react` isn't in devDependencies, check what LayerStrip.test.tsx uses and mirror that instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/GenfillWidgetBody.test.tsx`
Expected: FAIL — cannot resolve `./GenfillWidgetBody`

- [ ] **Step 3: Implement the body**

Create `src/components/widget/GenfillWidgetBody.tsx`. Complete component (adapt class names to the design tokens / neighboring widget-body styling — copy input/button classes from `RefineInput.tsx` so it matches the register; keep every sub-component at module scope):

```tsx
import { useMemo, useState } from 'react';
import { Pin, RefreshCw, Sparkles } from 'lucide-react';
import type { Widget } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import { acceptGenfill, discardGenfill } from '@/store/genfill-actions';
import { genfillAssetUrl } from '@/lib/genfill-asset';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';

interface GenfillWidgetBodyProps {
  widget: Widget;
}

/** Image-node reference dimensions: the first image layer's canvas. Used to
 *  decide whether the result can be clipped by the input mask (dims must
 *  match exactly — never silently rescale). */
function imageNodeDims(imageNodeId: string): { width: number; height: number } | null {
  const editor = useEditorStore.getState();
  const node = editor.imageNodes[imageNodeId];
  const layerId = node?.layerIds.find(
    (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
  );
  const canvas = layerId ? pixelStore.get(layerId) : null;
  return canvas ? { width: canvas.width, height: canvas.height } : null;
}

export function GenfillWidgetBody({ widget }: GenfillWidgetBodyProps) {
  const g = widget.genfill;
  const sessionId = useBackendState((s) => s.snapshot?.sessionId);
  const [prompt, setPrompt] = useState(g?.prompt ?? '');
  const [negative, setNegative] = useState(g?.negativePrompt ?? '');
  const [negativeOpen, setNegativeOpen] = useState(false);
  const [clip, setClip] = useState(true);
  const [seedPinned, setSeedPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const dims = useMemo(
    () => (g ? imageNodeDims(g.imageNodeId) : null),
    [g],
  );
  if (!g || !sessionId) return null;

  const generating = g.status === 'generating';
  const dimsMatch =
    g.status === 'ready' && !!g.result && !!dims &&
    g.result.width === dims.width && g.result.height === dims.height;

  const submit = async (seed?: number) => {
    if (!prompt.trim() || generating) return;
    setBusy(true);
    await backendTools.genfill_regenerate(sessionId, {
      widgetId: widget.id,
      prompt: prompt.trim(),
      negativePrompt: negative.trim() || undefined,
      ...(seed !== undefined ? { seed } : {}),
    });
    setBusy(false);
  };

  const handleAccept = async () => {
    setBusy(true);
    await acceptGenfill(widget.id, { clip: clip && dimsMatch });
    setBusy(false);
  };

  return (
    <div className="px-1.5 py-1 flex flex-col gap-1.5">
      {/* Prompt */}
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
        }}
        placeholder="Describe what to generate…"
        disabled={generating || busy}
        autoFocus={g.status === 'compose'}
        className="w-full bg-transparent text-[12px] text-text-primary border border-separator rounded-[3px] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
      />
      {/* Negative prompt (collapsed) */}
      {negativeOpen ? (
        <input
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          placeholder="Negative prompt (what to avoid)…"
          disabled={generating || busy}
          className="w-full bg-transparent text-[12px] text-text-secondary border border-separator rounded-[3px] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
        />
      ) : (
        <button
          type="button"
          className="self-start text-[10px] text-text-secondary hover:text-text-primary"
          onClick={() => setNegativeOpen(true)}
        >
          + Negative prompt
        </button>
      )}

      {/* Compose: Generate. Otherwise seed row + regenerate. */}
      {g.status === 'compose' ? (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!prompt.trim() || busy}
          className="inline-flex items-center gap-1 self-end text-[11px] px-2 py-1 rounded-[3px] bg-[var(--color-accent)] text-white disabled:opacity-50"
        >
          <Sparkles size={11} /> Generate
        </button>
      ) : (
        <div className="flex items-center justify-between text-[10px] text-text-secondary">
          <span className="inline-flex items-center gap-1">
            Seed {g.seed}
            <button
              type="button"
              aria-label={seedPinned ? 'Unpin seed' : 'Pin seed'}
              onClick={() => setSeedPinned((p) => !p)}
              className={seedPinned ? 'text-[var(--color-accent)]' : 'hover:text-text-primary'}
            >
              <Pin size={10} />
            </button>
          </span>
          <button
            type="button"
            disabled={generating || busy || !prompt.trim()}
            onClick={() => void submit(seedPinned ? g.seed : undefined)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary disabled:opacity-50"
          >
            <RefreshCw size={10} className={generating ? 'animate-spin' : ''} /> Regenerate
          </button>
        </div>
      )}

      {/* Preview / skeleton / error */}
      {generating && (
        <div
          data-testid="genfill-skeleton"
          className="w-full aspect-video rounded-[3px] bg-surface-secondary animate-pulse"
        />
      )}
      {g.status === 'ready' && g.result && (
        <img
          src={genfillAssetUrl(sessionId, g.result.assetId)}
          alt={g.prompt}
          className="w-full rounded-[3px] border border-separator"
        />
      )}
      {g.status === 'error' && g.error && (
        <div className="text-[11px] text-[var(--color-danger,#e5484d)] flex items-center justify-between gap-2">
          <span>{g.error.message}</span>
          {g.error.kind !== 'not_configured' && (
            <button
              type="button"
              onClick={() => void submit(g.seed)}
              className="px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary shrink-0"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Ready: clip toggle + Accept / Discard */}
      {g.status === 'ready' && g.result && (
        <>
          <label className="flex items-center gap-1.5 text-[11px] text-text-primary">
            <input
              type="checkbox"
              aria-label="Clip to region"
              checked={clip && dimsMatch}
              disabled={!dimsMatch}
              onChange={(e) => setClip(e.target.checked)}
            />
            Clip to region
            {!dimsMatch && (
              <span className="text-[10px] text-text-secondary">(dimensions differ)</span>
            )}
          </label>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void discardGenfill(widget.id)}
              className="text-[11px] px-2 py-1 rounded-[3px] border border-separator hover:bg-surface-secondary"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAccept()}
              className="text-[11px] px-2 py-1 rounded-[3px] bg-[var(--color-accent)] text-white disabled:opacity-50"
            >
              Accept
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into WidgetShell**

In `src/components/widget/WidgetShell.tsx`, add next to the other bespoke-body branches (the `isHslWidget`/`isCurvesWidget` block around lines 267–286):

```tsx
{widget.genfill && <GenfillWidgetBody widget={widget} />}
```

and gate the OTHER body branches + the refine footer so they don't render for genfill widgets: genfill widgets have `bindings.length === 0`, so the binding-gated branches are already inert — verify the compound branch (`loadRegistry().ops[widget.opId ?? '']` with undefined opId) and the footer (RefineInput toggle, history stepper, auto button) don't render or misbehave for a widget with no bindings/opId. Where a footer affordance would render for genfill, add `&& !widget.genfill` to its condition. Import at top: `import { GenfillWidgetBody } from './GenfillWidgetBody';`.

- [ ] **Step 5: Run tests + check**

Run: `npx vitest run src/components/widget/GenfillWidgetBody.test.tsx && npm run check`
Expected: PASS (including the no-nested-component rule)

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/GenfillWidgetBody.tsx src/components/widget/GenfillWidgetBody.test.tsx src/components/widget/WidgetShell.tsx
git commit -m "feat(genfill): bespoke widget body — compose/generating/ready/error, clip toggle, accept/discard"
```

---

### Task 8: Right-click entry points (object mask ×2, object layer)

**Files:**
- Modify: `src/components/workspace/drafting/ObjectMarkers.tsx` (menu item)
- Modify: `src/components/workspace/ImageNodeObjectsLayer.tsx` (menu item)
- Modify: `src/components/workspace/drafting/LayerStrip.tsx` (menu item)

**Interfaces:**
- Consumes: `spawnGenfillFromMask(maskId, imageNodeId)`, `spawnGenfillFromLayer(layerId, imageNodeId)` (Task 5). Both menus already have `obj.id` (mask id) and `imageNodeId` in scope; LayerStrip has `layer.id` and `imageNodeId`.
- Produces: three "Generative fill…" menu items. No new components.

- [ ] **Step 1: ObjectMarkers.tsx**

In the `ContextMenu.Content` block (after the "Extract to Image Node" item at ~line 344, before the separator + delete item), add:

```tsx
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => void spawnGenfillFromMask(obj.id, imageNodeId)}
          >
            Generative fill…
          </ContextMenu.Item>
```

Import: `import { spawnGenfillFromMask } from '@/lib/genfill-spawn';`

- [ ] **Step 2: ImageNodeObjectsLayer.tsx**

Same item, same placement pattern, in that file's `ContextMenu.Content` (after its extract items):

```tsx
          <ContextMenu.Item
            className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
            onSelect={() => void spawnGenfillFromMask(obj.id, imageNodeId)}
          >
            Generative fill…
          </ContextMenu.Item>
```

- [ ] **Step 3: LayerStrip.tsx**

After the "Create selection" item, add:

```tsx
      <ContextMenu.Item
        className={MENU_ITEM}
        onSelect={() => void spawnGenfillFromLayer(layer.id, imageNodeId)}
      >
        Generative fill…
      </ContextMenu.Item>
```

Import: `import { spawnGenfillFromLayer } from '@/lib/genfill-spawn';`

- [ ] **Step 4: Active-selection entry point**

The spec's entry table also lists the active selection as a right-click source. Locate where a live/active selection is right-clickable: `grep -n "ContextMenu\|onContextMenu" src/components/workspace/SegmentHitLayer.tsx src/components/workspace/ImageNodeObjectsLayer.tsx` and check how the live selection (`LiveSelection` from the selection slice / segmentation lib) surfaces a menu today.

- If a selection context menu exists: add the same "Generative fill…" item. The live selection is not yet a registered mask — materialize it first exactly the way "Select …" actions do (see `materializeCandidate` in `src/lib/segmentation/candidate-actions.ts`, which takes a `LiveSelection` and returns a registered `maskId`), then call `spawnGenfillFromMask(maskId, imageNodeId)`:

```tsx
onSelect={() =>
  void (async () => {
    const maskId = await materializeCandidate(sel, {
      sessionId, imageNodeId, existingCount: /* same source as neighboring callers */,
    });
    if (maskId) await spawnGenfillFromMask(maskId, imageNodeId);
  })()
}
```

- If NO selection context menu exists today: skip this surface (the selection is still reachable via object-mask right-click after materializing, and via Cmd+K chips) and record the skip in the commit message body as `selection right-click deferred — no selection context menu exists yet`.

- [ ] **Step 5: Verify + commit**

Run: `npm run check`
Expected: PASS

Manual smoke (optional but recommended): `npm run dev` + `npm run dev:backend`, open an image, segment an object, right-click its label → "Generative fill…" → a compose-state widget appears tethered to the image node.

```bash
git add src/components/workspace/drafting/ObjectMarkers.tsx src/components/workspace/ImageNodeObjectsLayer.tsx src/components/workspace/drafting/LayerStrip.tsx
git commit -m "feat(genfill): right-click entry points on object masks and layers"
```

---

### Task 9: Cmd+K third mode — "Generative fill"

**Files:**
- Modify: `src/components/CommandPalette.tsx` (mode union, pill, submit handler, results view)
- Create: `src/components/CommandPaletteGenfillView.tsx`
- Test: extend `src/components/CommandPalette.test.tsx` or add `CommandPaletteGenfillView.test.tsx`

**Interfaces:**
- Consumes: palette internals — `PaletteMode` (line ~53), the mode pill UI (the control that toggles `'agent' | 'ask'` — locate it near the input row), the keydown submit handler (mode-dispatch around line ~511), region chips in `doc` (`kind: 'chip'`, with `sourceId`), `masksIndex` from `useBackendState`, `useAiAccess()`. `spawnGenfillFromMask(maskId, imageNodeId, prompt, 'mcp_user_prompt')` (Task 5).
- Produces: third palette mode `'genfill'` with its own results view; submit spawns a genfill widget already in `generating` state (prompt included).
- Region resolution rule (v1): the FIRST chip in the prompt doc whose `sourceId` matches an entry in `snapshot.masksIndex` is the target mask; its `imageNodeId` (from the mask summary, falling back to the active image node) is the target node. No chip with a mask match → submit disabled with hint. Named-region chips without a materialized mask are NOT resolved in v1 (deferred; the hint tells the user to attach an object).

- [ ] **Step 1: Add the mode + view**

In `src/components/CommandPalette.tsx`:

1. `type PaletteMode = 'agent' | 'ask' | 'genfill';`
2. Extend the mode pill: find where the `'ask'` pill/toggle renders and add a third option labeled `Generative fill` (gate on `aiAccess` exactly like ask). Follow the existing pill's markup — do not invent a new control style.
3. In the keydown handler, BEFORE the `mode === 'ask'` branch, add:

```tsx
if (mode === 'genfill') {
  if (e.key === 'Enter') {
    e.preventDefault();
    const masksIndex = useBackendState.getState().snapshot?.masksIndex ?? [];
    const chip = doc.find(
      (s): s is Extract<PromptDoc[number], { kind: 'chip' }> =>
        s.kind === 'chip' && masksIndex.some((m) => m.id === s.sourceId),
    );
    if (!chip) return; // no resolvable region — view shows the hint
    const summary = masksIndex.find((m) => m.id === chip.sourceId)!;
    const imageNodeId =
      summary.imageNodeId ?? useEditorStore.getState().activeImageNodeId ?? 'in-default';
    const prompt = docToPlainText(doc).trim();
    if (!prompt) return;
    void spawnGenfillFromMask(chip.sourceId, imageNodeId, prompt, 'mcp_user_prompt');
    setOpen(false);
  }
  return;
}
```

(Adapt: `activeImageNodeId` accessor per `workspace-slice.ts`; `docToPlainText` already exists; imports for `spawnGenfillFromMask` and `useBackendState` if not present.)

4. In the results area, next to the `mode === 'ask'` render branch:

```tsx
) : mode === 'genfill' ? (
  <CommandPaletteGenfillView hasRegion={genfillHasRegion} draft={query} />
) : (
```

with `genfillHasRegion` computed via `useMemo` from `doc` + `masksIndex` (same predicate as the submit handler).

- [ ] **Step 2: Create the view**

Create `src/components/CommandPaletteGenfillView.tsx`:

```tsx
import { Sparkles } from 'lucide-react';

interface GenfillViewProps {
  hasRegion: boolean;
  draft: string;
}

/** Static instruction panel for the palette's Generative fill mode. The
 *  actual submit lives in CommandPalette's keydown handler; this view only
 *  reflects whether a resolvable region chip is attached. */
export function CommandPaletteGenfillView({ hasRegion, draft }: GenfillViewProps) {
  return (
    <div className="flex-1 min-h-0 px-3 py-3 text-[12px] text-text-secondary">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-ai)] mb-2 inline-flex items-center gap-1">
        <Sparkles size={9} />
        <span>Generative fill</span>
      </div>
      {hasRegion ? (
        <p>
          Press <kbd className="px-1 border border-separator rounded-[3px]">Enter</kbd> to
          generate{draft.trim() ? '' : ' — describe what should appear in the region'}.
          The result lands on a new layer after you accept it.
        </p>
      ) : (
        <p>Attach a region to fill — type <span className="text-text-primary">@</span> to
          reference an object mask. Generative fill needs a target region.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Test**

Add to the palette tests (mirror `CommandPalette.test.tsx` setup — it already knows how to open the palette and seed state) or as a standalone view test:

```tsx
// CommandPaletteGenfillView renders the no-region hint
render(<CommandPaletteGenfillView hasRegion={false} draft="" />);
expect(screen.getByText(/attach a region to fill/i)).toBeTruthy();
// and the ready instruction when a region is attached
render(<CommandPaletteGenfillView hasRegion={true} draft="a boat" />);
expect(screen.getByText(/press/i)).toBeTruthy();
```

If the existing `CommandPalette.test.tsx` has an ask-mode submit test, clone it for genfill mode: seed a snapshot with `masksIndex: [{ id: 'm1', width: 2, height: 2, source: 'sam_point', label: 'boat', imageNodeId: 'in-default' }]`, a doc containing a chip with `sourceId: 'm1'` plus text `"a red boat"`, mock `@/lib/genfill-spawn`, press Enter, assert `spawnGenfillFromMask` called with `('m1', 'in-default', 'a red boat', 'mcp_user_prompt')`.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run src/components && npm run check`
Expected: PASS

```bash
git add src/components/CommandPalette.tsx src/components/CommandPaletteGenfillView.tsx src/components/CommandPalette.test.tsx
git commit -m "feat(genfill): Cmd+K generative-fill mode with region-chip requirement"
```

---

### Task 10: End-to-end verification + finish

**Files:** none new.

- [ ] **Step 1: Full test sweep**

Run: `npm run check && cd backend && source .venv/bin/activate && python -m pytest tests -q`
Expected: everything green.

- [ ] **Step 2: Live smoke test**

Prereq: the user has added `REPLICATE_API_TOKEN=...` to `backend/.env`. If it's missing, verify the `not_configured` path instead (widget shows "REPLICATE_API_TOKEN is not set", no Retry) and note it in the handoff.

1. `npm run dev` + `npm run dev:backend`; open an image.
2. Segment an object (object mode click), right-click its marker → "Generative fill…" → compose widget appears.
3. Type a prompt, Generate → skeleton → preview appears (~5–30 s).
4. Toggle "Clip to region" off/on; Accept with clip ON → new layer `Genfill: <prompt>` appears above; original layer unchanged; undo removes the layer.
5. Cmd+K → Generative fill pill → no chip: hint shown, Enter does nothing → attach `@object` + prompt → Enter → widget generating.
6. Regenerate with pinned seed → same seed shown; unpinned → new seed.
7. Discard a ready widget → widget leaves the panel; `backend/.sessions/<sid>/genfill-*.png` for that widget is gone.

- [ ] **Step 3: Spec conformance check**

Re-read `docs/superpowers/specs/2026-07-02-genfill-widget-design.md` section by section and confirm each design promise is implemented or explicitly deferred (deferred list: result history, autonomous suggestions, bbox-crop layers, mask dilation). Fix gaps before finishing.

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill (merge to `dev` / PR per the user's branch strategy).
