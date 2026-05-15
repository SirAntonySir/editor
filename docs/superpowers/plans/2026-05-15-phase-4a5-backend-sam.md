# Phase 4 Plan A.5 — Backend SAM + Region Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Plan A's in-browser SAM (ONNX) with a Python backend service (Meta's `segment-anything`), and refine every `candidateRegion` from `/api/analyze` into a real SAM mask before returning.

**Architecture:** A `SamClient` service in `backend/app/services/sam_client.py` loads SAM ViT-B (MPS on Apple Silicon, CPU fallback) once at startup. Two new endpoints — `/api/segment/embed` (per-session embedding, cached) and `/api/segment/decode` (per-prompt mask, base64 PNG response). `/api/analyze` extended to walk `candidateRegions` and bundle a SAM mask per region. Frontend's `samClient.ts` rewritten as an HTTP client; ONNX worker + model loader deleted; rest of Plan A unchanged.

**Tech Stack:** Backend — Python 3.11 + FastAPI + Pydantic 2.9 + PyTorch ≥2.1 (MPS) + Meta `segment-anything` + Pillow. Frontend — TypeScript strict + Zustand + Plan A's existing `MaskStore` / selection tools.

**Spec:** `docs/superpowers/specs/2026-05-15-phase-4a5-backend-sam-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `backend/requirements.txt` | modify | Add torch, torchvision, segment-anything, pillow, numpy |
| `backend/scripts/download_sam.sh` | create | One-shot SAM checkpoint fetch |
| `backend/README.md` | modify | Document `download_sam.sh` step |
| `backend/app/config.py` | modify | `sam_model_name`, `sam_checkpoint_path` settings |
| `backend/app/schemas/image_context.py` | modify | Add `RegionMask`; `CandidateRegion.mask: RegionMask \| None` |
| `backend/app/services/sam_client.py` | create | SamClient singleton — embed + decode |
| `backend/app/api/deps.py` | modify | Wire `SamClient` singleton; `get_sam_client()` |
| `backend/app/api/segment.py` | create | `/api/segment/embed` + `/api/segment/decode` |
| `backend/app/api/__init__.py` | modify | Register `segment.router` |
| `backend/app/api/analyze.py` | modify | After Claude returns context, run SAM at each region's representative_point |
| `backend/tests/test_segment_endpoint.py` | create | Endpoint smoke tests (stub SamClient) |
| `backend/tests/test_sam_client.py` | create | SamClient logic tests (mocked PyTorch) |
| `src/lib/sam/model-loader.ts` | delete | ONNX no longer used |
| `src/workers/sam.worker.ts` | delete | ONNX worker no longer used |
| `src/lib/sam/sam-client.ts` | rewrite | HTTP client calling new backend endpoints |
| `package.json` | modify | Remove `onnxruntime-web` dep |
| `vite.config.ts` | modify | Remove `worker.format` if no other workers use it; verify |
| `src/hooks/useImageContext.ts` | modify | After `/api/analyze`, register each region's mask in `MaskStore` |
| `src/types/image-context.ts` | modify | Add optional `mask` field on `CandidateRegion`; add `maskRef` frontend-only field |
| `src/lib/image-context-schema.ts` | modify | Zod schema for region mask |
| `src/components/AiCommandPalette.tsx` | modify | Region pills become click-to-commit-mask actions |

---

## Test conventions

**Backend:** `cd backend && pytest`. Test file: `backend/tests/test_*.py`. Conftest in `backend/tests/conftest.py` provides fixtures. SamClient tests mock PyTorch to avoid downloading the checkpoint in CI. Endpoint tests stub the `SamClient` dependency override via FastAPI's `app.dependency_overrides`.

**Frontend:** `npm run test:run` (vitest, node env). Reset pattern (existing):
```ts
beforeEach(() => {
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});
```

**Full check** (run before each commit): `cd backend && pytest && cd .. && npm run check`. The frontend pre-commit hook runs `npm run check`; the backend has no pre-commit hook so engineers run `pytest` manually.

43 pre-existing frontend lint warnings; do NOT fix them.

---

## Task 1 — Backend deps + checkpoint download script

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/scripts/download_sam.sh`
- Modify: `backend/README.md`
- Modify: `backend/app/config.py`
- Modify: `backend/.env.example` (if it exists — otherwise document in README)

- [ ] **Step 1: Add deps to `backend/requirements.txt`**

Append to the file (do not delete existing entries):

```
torch>=2.1.0
torchvision>=0.16.0
pillow>=10.0.0
numpy>=1.26.0
segment-anything @ git+https://github.com/facebookresearch/segment-anything.git
```

The `git+https://` install pulls Meta's official package directly from GitHub since it's not on PyPI. Mac users with Apple Silicon get MPS support automatically.

- [ ] **Step 2: Create `backend/scripts/download_sam.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p models

CKPT_URL="https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
CKPT_PATH="models/sam_vit_b_01ec64.pth"

if [ -f "$CKPT_PATH" ]; then
  echo "SAM checkpoint already present at $CKPT_PATH"
  exit 0
fi

echo "Downloading SAM ViT-B checkpoint (~375 MB)..."
curl -L --fail -o "$CKPT_PATH.partial" "$CKPT_URL"
mv "$CKPT_PATH.partial" "$CKPT_PATH"
echo "Done: $CKPT_PATH"
```

Make executable:
```bash
chmod +x backend/scripts/download_sam.sh
```

- [ ] **Step 3: Update `backend/app/config.py`**

Read the current file first. Add the new settings:

```python
class Settings(BaseSettings):
    # ... existing fields preserved
    sam_model_name: Literal['vit_b', 'vit_l', 'vit_h'] = 'vit_b'
    sam_checkpoint_path: str = './models/sam_vit_b_01ec64.pth'
```

Make sure `Literal` is imported from `typing` if not already.

- [ ] **Step 4: Document in `backend/README.md`**

Add to the bootstrap section (after the existing `pip install` line):

```markdown
### Download SAM checkpoint

After installing deps, fetch the SAM ViT-B checkpoint (~375 MB, one-time):

```bash
./scripts/download_sam.sh
```

This places the file at `models/sam_vit_b_01ec64.pth`. To use a different
model variant (ViT-L or ViT-H), set `SAM_MODEL_NAME` and `SAM_CHECKPOINT_PATH`
in `.env`.
```

- [ ] **Step 5: Install + verify**

```bash
cd backend && source .venv/bin/activate && pip install -r requirements.txt
./scripts/download_sam.sh
ls -lh models/sam_vit_b_01ec64.pth
```

Expected: file present, ~375 MB.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/requirements.txt backend/scripts/download_sam.sh \
        backend/README.md backend/app/config.py
git commit -m "feat(backend): add SAM deps + checkpoint download script"
```

---

## Task 2 — `RegionMask` schema + `CandidateRegion.mask` field

**Files:**
- Modify: `backend/app/schemas/image_context.py`
- Modify: `backend/tests/test_schemas.py`

- [ ] **Step 1: Append failing test to `backend/tests/test_schemas.py`**

```python
from app.schemas.image_context import CandidateRegion, RegionMask


def test_candidate_region_accepts_mask_field():
    region = CandidateRegion(
        label="sky",
        description="upper portion",
        representative_point=[0.5, 0.2],
        mask=RegionMask(png_base64="iVBORw0KGgo=", width=1024, height=768),
    )
    assert region.mask is not None
    assert region.mask.width == 1024


def test_candidate_region_mask_is_optional():
    region = CandidateRegion(
        label="sky",
        description="upper portion",
        representative_point=[0.5, 0.2],
    )
    assert region.mask is None
```

- [ ] **Step 2: Run, verify fail**

```bash
cd /Users/anton/Dev/Projects/editor/backend && source .venv/bin/activate
pytest tests/test_schemas.py::test_candidate_region_accepts_mask_field -v
```
Expected: FAIL — `RegionMask` not importable.

- [ ] **Step 3: Add `RegionMask` to `backend/app/schemas/image_context.py`**

Add the new class before `CandidateRegion`, and add the `mask` field:

```python
class RegionMask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    png_base64: str
    width: int
    height: int


class CandidateRegion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    description: str
    bbox: list[float] | None = Field(default=None, min_length=4, max_length=4)
    representative_point: list[float] | None = Field(default=None, min_length=2, max_length=2)
    mask: RegionMask | None = None
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_schemas.py -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/schemas/image_context.py backend/tests/test_schemas.py
git commit -m "feat(backend): RegionMask schema + CandidateRegion.mask field"
```

---

## Task 3 — `SamClient` service

**Files:**
- Create: `backend/app/services/sam_client.py`
- Create: `backend/tests/test_sam_client.py`

The service wraps Meta's `SamPredictor`. We test the logic in isolation by mocking the underlying `SamPredictor` so the test doesn't need the checkpoint or GPU.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_sam_client.py
from __future__ import annotations

import numpy as np
import pytest
from unittest.mock import MagicMock, patch

from app.services.sam_client import SamClient


def _fake_settings(model="vit_b", path="/fake/path"):
    s = MagicMock()
    s.sam_model_name = model
    s.sam_checkpoint_path = path
    return s


@pytest.fixture
def patched_sam():
    """Patches the sam_model_registry + SamPredictor to skip real model load."""
    with patch("app.services.sam_client.sam_model_registry") as registry, \
         patch("app.services.sam_client.SamPredictor") as predictor_cls:
        registry.__getitem__.return_value.return_value = MagicMock()  # sam object
        predictor = MagicMock()
        predictor_cls.return_value = predictor
        yield predictor


def _make_dummy_image() -> np.ndarray:
    return np.zeros((100, 100, 3), dtype=np.uint8)


class TestSamClient:
    def test_embed_caches_per_session(self, patched_sam):
        client = SamClient(_fake_settings())
        img = _make_dummy_image()
        client.embed("session-A", img)
        client.embed("session-A", img)
        # set_image should only be called once for the same session
        assert patched_sam.set_image.call_count == 1

    def test_embed_invalidates_when_session_changes(self, patched_sam):
        client = SamClient(_fake_settings())
        img = _make_dummy_image()
        client.embed("session-A", img)
        client.embed("session-B", img)
        assert patched_sam.set_image.call_count == 2

    def test_decode_point_returns_best_mask(self, patched_sam):
        client = SamClient(_fake_settings())
        # Three candidate masks; mask index 1 has highest score.
        m0 = np.zeros((50, 50), dtype=bool)
        m1 = np.ones((50, 50), dtype=bool)
        m2 = np.zeros((50, 50), dtype=bool)
        patched_sam.predict.return_value = (
            np.stack([m0, m1, m2]),
            np.array([0.1, 0.9, 0.5]),
            None,
        )
        client.embed("s", _make_dummy_image())
        out = client.decode_point(
            "s",
            points=np.array([[10.0, 20.0]], dtype=np.float32),
            labels=np.array([1], dtype=np.float32),
        )
        assert out.shape == (50, 50)
        assert out.all()

    def test_decode_box_uses_box_predict(self, patched_sam):
        client = SamClient(_fake_settings())
        mask = np.ones((50, 50), dtype=bool)
        patched_sam.predict.return_value = (
            np.stack([mask]),
            np.array([0.95]),
            None,
        )
        client.embed("s", _make_dummy_image())
        out = client.decode_box(
            "s", box=np.array([0.0, 0.0, 50.0, 50.0], dtype=np.float32),
        )
        # box= kwarg was passed
        kwargs = patched_sam.predict.call_args.kwargs
        assert "box" in kwargs
        assert out.shape == (50, 50)

    def test_decode_requires_prior_embed(self, patched_sam):
        client = SamClient(_fake_settings())
        with pytest.raises(RuntimeError, match="not embedded"):
            client.decode_point(
                "session-never-embedded",
                points=np.array([[1.0, 1.0]], dtype=np.float32),
                labels=np.array([1], dtype=np.float32),
            )
```

- [ ] **Step 2: Verify tests fail**

```bash
cd /Users/anton/Dev/Projects/editor/backend && source .venv/bin/activate
pytest tests/test_sam_client.py -v
```
Expected: FAIL — `app.services.sam_client` not importable.

- [ ] **Step 3: Implement `backend/app/services/sam_client.py`**

```python
from __future__ import annotations

from threading import Lock
from typing import TYPE_CHECKING

import numpy as np
import torch
from segment_anything import SamPredictor, sam_model_registry

if TYPE_CHECKING:
    from app.config import Settings


def _pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class SamClient:
    """Wraps Meta's segment-anything predictor.

    Singleton lifetime — model load is expensive. Single-active-session
    embedding cache: calling embed() with a new session_id invalidates the
    previous embedding.
    """

    def __init__(self, settings: "Settings") -> None:
        device = _pick_device()
        sam = sam_model_registry[settings.sam_model_name](
            checkpoint=settings.sam_checkpoint_path,
        )
        sam.to(device)
        self._predictor = SamPredictor(sam)
        self._embedded_session: str | None = None
        self._lock = Lock()
        self.device = device
        self.model_name = settings.sam_model_name

    def embed(self, session_id: str, image_rgb: np.ndarray) -> None:
        """Encode image. Cached per session_id. Idempotent."""
        with self._lock:
            if self._embedded_session == session_id:
                return
            self._predictor.set_image(image_rgb)
            self._embedded_session = session_id

    def _ensure_embedded(self, session_id: str) -> None:
        if self._embedded_session != session_id:
            raise RuntimeError(
                f"session {session_id!r} is not embedded; call embed() first",
            )

    def decode_point(
        self,
        session_id: str,
        points: np.ndarray,
        labels: np.ndarray,
    ) -> np.ndarray:
        """Returns a single 2D bool mask at the image's resolution."""
        with self._lock:
            self._ensure_embedded(session_id)
            masks, scores, _ = self._predictor.predict(
                point_coords=points,
                point_labels=labels,
                multimask_output=True,
            )
        best = int(np.argmax(scores))
        return masks[best]

    def decode_box(self, session_id: str, box: np.ndarray) -> np.ndarray:
        """Returns a single 2D bool mask for a box prompt."""
        with self._lock:
            self._ensure_embedded(session_id)
            masks, scores, _ = self._predictor.predict(
                box=box,
                multimask_output=True,
            )
        best = int(np.argmax(scores))
        return masks[best]
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_sam_client.py -v
```
Expected: PASS, 5/5.

- [ ] **Step 5: Run all backend tests**

```bash
pytest
```
Expected: PASS, all existing + 5 new + 2 from Task 2.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/services/sam_client.py backend/tests/test_sam_client.py
git commit -m "feat(backend): SamClient service with cached embedding + decode"
```

---

## Task 4 — Wire `SamClient` into `deps.py`

**Files:**
- Modify: `backend/app/api/deps.py`

- [ ] **Step 1: Update `backend/app/api/deps.py`**

```python
from app.config import get_settings
from app.services.anthropic_client import AnthropicClient
from app.services.sam_client import SamClient
from app.services.session_store import SessionStore

_settings = get_settings()
_session_store = SessionStore(ttl_seconds=_settings.session_ttl_seconds)
_anthropic_client = AnthropicClient(
    api_key=_settings.anthropic_api_key,
    model=_settings.anthropic_model,
)
_sam_client: SamClient | None = None


def get_session_store() -> SessionStore:
    return _session_store


def get_anthropic_client() -> AnthropicClient:
    return _anthropic_client


def get_sam_client() -> SamClient:
    global _sam_client
    if _sam_client is None:
        _sam_client = SamClient(_settings)
    return _sam_client
```

The lazy init avoids loading the SAM model at import time (which would slow down test collection and slow down `pytest` even for tests that don't need SAM). The first request to a SAM-using endpoint pays the load cost.

- [ ] **Step 2: Run check (just import)**

```bash
cd /Users/anton/Dev/Projects/editor/backend && source .venv/bin/activate
python -c "from app.api.deps import get_sam_client; print('ok')"
```
Expected: prints `ok`. (Doesn't actually call `get_sam_client()` — that would trigger model load.)

- [ ] **Step 3: Run full pytest**

```bash
pytest
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/api/deps.py
git commit -m "feat(backend): wire SamClient singleton with lazy init"
```

---

## Task 5 — `/api/segment/embed` + `/api/segment/decode` endpoints

**Files:**
- Create: `backend/app/api/segment.py`
- Modify: `backend/app/api/__init__.py`
- Create: `backend/tests/test_segment_endpoint.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_segment_endpoint.py
import base64
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_sam_client, get_session_store
from app.main import app
from app.services.session_store import SessionStore


@pytest.fixture
def client_with_session(tmp_path):
    """Provides a TestClient, a SessionStore with one fake session, and a mock SamClient."""
    store = SessionStore(ttl_seconds=3600)
    # Build a 4x4 red PNG inline so the analyze handler has real bytes.
    from PIL import Image
    import io
    img = Image.new("RGB", (4, 4), color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    sid = store.create(image_bytes=buf.getvalue(), mime_type="image/png")

    sam = MagicMock()
    # decode_point returns a non-empty 4x4 mask
    sam.decode_point.return_value = np.array([
        [True, True, False, False],
        [True, True, False, False],
        [False, False, False, False],
        [False, False, False, False],
    ])
    sam.decode_box.return_value = np.ones((4, 4), dtype=bool)

    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_sam_client] = lambda: sam
    yield TestClient(app), sid, sam
    app.dependency_overrides.clear()


def test_embed_endpoint_calls_sam_embed(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/embed", json={"session_id": sid})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    sam.embed.assert_called_once()
    # First arg is session_id, second is np.ndarray
    args = sam.embed.call_args.args
    assert args[0] == sid
    assert hasattr(args[1], "shape")


def test_embed_returns_404_for_unknown_session(client_with_session):
    client, _, _ = client_with_session
    res = client.post("/api/segment/embed", json={"session_id": "missing"})
    assert res.status_code == 404


def test_decode_point_returns_png(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/decode", json={
        "session_id": sid,
        "prompts": [{"kind": "point", "data": [1.0, 1.0, 1]}],
    })
    assert res.status_code == 200
    body = res.json()
    assert body["width"] == 4
    assert body["height"] == 4
    assert body["model"].startswith("sam-")
    # Base64 PNG decodes to bytes starting with the PNG signature.
    raw = base64.b64decode(body["mask_png_base64"])
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_decode_box_uses_decode_box(client_with_session):
    client, sid, sam = client_with_session
    res = client.post("/api/segment/decode", json={
        "session_id": sid,
        "prompts": [{"kind": "box", "data": [0.0, 0.0, 4.0, 4.0]}],
    })
    assert res.status_code == 200
    sam.decode_box.assert_called_once()
    sam.decode_point.assert_not_called()
```

- [ ] **Step 2: Verify tests fail**

```bash
pytest tests/test_segment_endpoint.py -v
```
Expected: FAIL — `/api/segment/...` not registered.

- [ ] **Step 3: Create `backend/app/api/segment.py`**

```python
from __future__ import annotations

import base64
import io
import time
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from app.services.sam_client import SamClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


class EmbedRequest(BaseModel):
    session_id: str


class EmbedResponse(BaseModel):
    ok: bool
    embedded_at: float


class SegmentPrompt(BaseModel):
    kind: Literal["point", "box"]
    data: list[float] = Field(min_length=3, max_length=4)


class DecodeRequest(BaseModel):
    session_id: str
    prompts: list[SegmentPrompt] = Field(min_length=1)


class DecodeResponse(BaseModel):
    mask_png_base64: str
    width: int
    height: int
    model: str


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_sam() -> SamClient:
    return deps.get_sam_client()


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_to_png_base64(mask: np.ndarray) -> str:
    """Convert a bool/uint8 mask to a single-channel PNG, base64-encoded."""
    if mask.dtype == bool:
        arr = (mask.astype(np.uint8)) * 255
    else:
        arr = mask.astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


@router.post("/segment/embed", response_model=EmbedResponse)
async def embed(
    body: EmbedRequest,
    store: SessionStore = Depends(_get_store),
    sam: SamClient = Depends(_get_sam),
) -> EmbedResponse:
    try:
        rec = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    image_rgb = _decode_image_rgb(rec.image_bytes)
    sam.embed(body.session_id, image_rgb)
    return EmbedResponse(ok=True, embedded_at=time.time())


@router.post("/segment/decode", response_model=DecodeResponse)
async def decode(
    body: DecodeRequest,
    sam: SamClient = Depends(_get_sam),
) -> DecodeResponse:
    # Validate prompt shapes.
    points: list[list[float]] = []
    labels: list[float] = []
    box: list[float] | None = None
    for p in body.prompts:
        if p.kind == "point":
            if len(p.data) != 3:
                raise HTTPException(status_code=400, detail=f"point prompt needs [x,y,label], got {p.data!r}")
            points.append([p.data[0], p.data[1]])
            labels.append(p.data[2])
        elif p.kind == "box":
            if len(p.data) != 4:
                raise HTTPException(status_code=400, detail=f"box prompt needs [x1,y1,x2,y2], got {p.data!r}")
            if box is not None:
                raise HTTPException(status_code=400, detail="multiple box prompts not supported")
            box = list(p.data)

    if box is not None and points:
        raise HTTPException(status_code=400, detail="mixing box and point prompts not supported")

    try:
        if box is not None:
            mask = sam.decode_box(body.session_id, np.array(box, dtype=np.float32))
        else:
            mask = sam.decode_point(
                body.session_id,
                points=np.array(points, dtype=np.float32),
                labels=np.array(labels, dtype=np.float32),
            )
    except RuntimeError as err:
        raise HTTPException(status_code=400, detail=str(err))

    return DecodeResponse(
        mask_png_base64=_mask_to_png_base64(mask),
        width=mask.shape[1],
        height=mask.shape[0],
        model=f"sam-{sam.model_name}" if hasattr(sam, "model_name") else "sam",
    )
```

- [ ] **Step 4: Register router in `backend/app/api/__init__.py`**

```python
from fastapi import APIRouter

from . import analyze, panel, refine, segment, session

router = APIRouter(prefix="/api")
router.include_router(session.router)
router.include_router(analyze.router)
router.include_router(panel.router)
router.include_router(refine.router)
router.include_router(segment.router)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_segment_endpoint.py -v
```
Expected: PASS, 4/4.

- [ ] **Step 6: Run all backend tests**

```bash
pytest
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/api/segment.py backend/app/api/__init__.py \
        backend/tests/test_segment_endpoint.py
git commit -m "feat(backend): /api/segment/embed and /api/segment/decode endpoints"
```

---

## Task 6 — `/api/analyze` bundles region masks

**Files:**
- Modify: `backend/app/api/analyze.py`
- Modify: `backend/tests/test_analyze_endpoint.py`

- [ ] **Step 1: Append failing test to `backend/tests/test_analyze_endpoint.py`**

Read the existing file first to see the testing pattern. Add this test using the same pattern:

```python
# backend/tests/test_analyze_endpoint.py — append
from unittest.mock import MagicMock
import numpy as np

from app.api.deps import get_anthropic_client, get_sam_client


def test_analyze_bundles_region_masks(tmp_path):
    """When Claude returns regions with representative points, the analyze
    handler runs SAM at each point and bundles the mask into the response."""
    from PIL import Image
    import io
    img = Image.new("RGB", (8, 8), color=(0, 128, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    store = SessionStore(ttl_seconds=3600)
    sid = store.create(image_bytes=buf.getvalue(), mime_type="image/png")

    # Mock Claude to return one region with a representative point.
    anthropic = MagicMock()
    from app.schemas.image_context import (
        CandidateRegion,
        ImageContext,
    )
    anthropic.analyze_image.return_value = ImageContext(
        subjects=["plant"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="calm",
        candidate_regions=[
            CandidateRegion(
                label="plant",
                description="leafy plant in centre",
                representative_point=[4.0, 4.0],
            ),
        ],
        model_name="claude",
        model_version="test",
        generated_at="2025-01-01T00:00:00Z",
    )

    sam = MagicMock()
    sam.decode_point.return_value = np.ones((8, 8), dtype=bool)

    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_anthropic_client] = lambda: anthropic
    app.dependency_overrides[get_sam_client] = lambda: sam

    try:
        with TestClient(app) as client:
            res = client.post("/api/analyze", json={"session_id": sid})
            assert res.status_code == 200
            body = res.json()
            assert len(body["candidate_regions"]) == 1
            region = body["candidate_regions"][0]
            assert region["mask"] is not None
            assert region["mask"]["width"] == 8
            assert region["mask"]["height"] == 8
            assert region["mask"]["png_base64"].startswith(("iVBOR", "/9j/", "Qk", "R0lGOD"))  # PNG base64
        # SAM was called: once to embed, once per region to decode
        sam.embed.assert_called_once()
        sam.decode_point.assert_called_once()
    finally:
        app.dependency_overrides.clear()
```

(The existing file probably has `TestClient`, `app`, `get_session_store`, `SessionStore` imports already. Reuse what's there.)

- [ ] **Step 2: Verify it fails**

```bash
cd /Users/anton/Dev/Projects/editor/backend && source .venv/bin/activate
pytest tests/test_analyze_endpoint.py::test_analyze_bundles_region_masks -v
```
Expected: FAIL — region mask is null.

- [ ] **Step 3: Update `backend/app/api/analyze.py`**

Replace the handler body to add the region-refinement loop. Read the existing file first; this version preserves the cached-context fast path:

```python
import base64
import io

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from pydantic import BaseModel

from app.schemas.image_context import ImageContext, RegionMask
from app.services.anthropic_client import AnthropicClient
from app.services.sam_client import SamClient
from app.services.session_store import SessionNotFound, SessionStore

from . import deps

router = APIRouter()


class AnalyzeRequest(BaseModel):
    session_id: str


def _get_store() -> SessionStore:
    return deps.get_session_store()


def _get_client() -> AnthropicClient:
    return deps.get_anthropic_client()


def _get_sam() -> SamClient:
    return deps.get_sam_client()


def _decode_image_rgb(image_bytes: bytes) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return np.array(img)


def _mask_to_png_base64(mask: np.ndarray) -> str:
    if mask.dtype == bool:
        arr = (mask.astype(np.uint8)) * 255
    else:
        arr = mask.astype(np.uint8)
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _refine_regions(context: ImageContext, image_rgb: np.ndarray, sam: SamClient, sid: str) -> None:
    """Mutates context.candidate_regions in place, populating .mask for each
    region that has a representative_point."""
    if not context.candidate_regions:
        return
    sam.embed(sid, image_rgb)
    for region in context.candidate_regions:
        if region.representative_point is None:
            continue
        px, py = region.representative_point
        # Convert from normalised (0–1) to pixel coords if needed.
        h, w = image_rgb.shape[:2]
        if 0.0 <= px <= 1.0 and 0.0 <= py <= 1.0:
            px, py = px * w, py * h
        try:
            mask = sam.decode_point(
                sid,
                points=np.array([[px, py]], dtype=np.float32),
                labels=np.array([1], dtype=np.float32),
            )
        except RuntimeError:
            continue
        if not mask.any():
            continue
        region.mask = RegionMask(
            png_base64=_mask_to_png_base64(mask),
            width=int(mask.shape[1]),
            height=int(mask.shape[0]),
        )


@router.post("/analyze", response_model=ImageContext)
async def analyze(
    body: AnalyzeRequest,
    store: SessionStore = Depends(_get_store),
    client: AnthropicClient = Depends(_get_client),
    sam: SamClient = Depends(_get_sam),
) -> ImageContext:
    try:
        record = store.get(body.session_id)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")

    if record.context is not None:
        return ImageContext.model_validate(record.context)

    context = client.analyze_image(
        image_bytes=record.image_bytes,
        mime_type=record.mime_type,
        session_id=body.session_id,
    )

    image_rgb = _decode_image_rgb(record.image_bytes)
    _refine_regions(context, image_rgb, sam, body.session_id)

    store.set_context(body.session_id, context.model_dump(mode="json"))
    return context
```

- [ ] **Step 4: Run the new test + full analyze test file**

```bash
pytest tests/test_analyze_endpoint.py -v
```
Expected: PASS (existing + new).

- [ ] **Step 5: Run full backend suite**

```bash
pytest
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/api/analyze.py backend/tests/test_analyze_endpoint.py
git commit -m "feat(backend): analyze refines candidate regions into SAM masks"
```

---

## Task 7 — Frontend: remove ONNX, delete old SAM files

**Files:**
- Delete: `src/lib/sam/model-loader.ts`
- Delete: `src/workers/sam.worker.ts`
- Modify: `package.json` (remove `onnxruntime-web`)
- Modify: `package-lock.json` (auto-updated by `npm install`)

- [ ] **Step 1: Remove the dependency**

```bash
cd /Users/anton/Dev/Projects/editor && npm uninstall onnxruntime-web
```

This edits `package.json` and `package-lock.json` automatically.

- [ ] **Step 2: Delete the files**

```bash
rm src/lib/sam/model-loader.ts src/workers/sam.worker.ts
```

- [ ] **Step 3: Run check**

```bash
npm run check
```

Expected output: TypeScript errors from `src/lib/sam/sam-client.ts` referencing the deleted files / deleted ONNX types. **This is expected** — the next task rewrites the client.

If the errors are anything *other* than the expected SAM-client breakage (e.g., something else imported the worker), report BLOCKED.

- [ ] **Step 4: Do NOT commit yet**

The build is intentionally broken here. Task 8 fixes it and the commit covers both tasks. Move on.

---

## Task 8 — Frontend `samClient.ts` rewritten as HTTP client

**Files:**
- Rewrite: `src/lib/sam/sam-client.ts`

- [ ] **Step 1: Replace the file contents**

```ts
// src/lib/sam/sam-client.ts
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { maskStore, type SamPrompt } from '@/core/mask-store';
import type { MaskRef } from '@/types/scope';

const API_BASE = '/api';

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * Decodes a base64 PNG (single-channel grayscale; backend writes 0 or 255)
 * into a Uint8Array of length width*height (0 or 255).
 */
export async function maskPngBase64ToBytes(
  pngBase64: string,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const dataUrl = `data:image/png;base64,${pngBase64}`;
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const tmp = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('maskPngBase64ToBytes: no 2d context');
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Uint8Array(bitmap.width * bitmap.height);
  // Single-channel PNG decodes as grayscale; the R channel carries the value.
  for (let i = 0; i < out.length; i++) out[i] = imgData.data[i * 4];
  bitmap.close();
  return { data: out, width: bitmap.width, height: bitmap.height };
}

export const samClient = {
  async ensureEmbedding(_layerId: string): Promise<void> {
    const sessionId = useAiSession.getState().sessionId;
    if (!sessionId) throw new Error('samClient.ensureEmbedding: no AI session');
    useEditorStore.getState().setEncoderState('encoding');
    try {
      await postJson('/segment/embed', { session_id: sessionId });
      useEditorStore.getState().setEncoderState('ready');
    } catch (err) {
      useEditorStore.getState().setEncoderState('error');
      throw err;
    }
  },

  async segment(args: {
    layerId: string;
    prompts: SamPrompt[];
    label?: string;
  }): Promise<MaskRef> {
    const sessionId = useAiSession.getState().sessionId;
    if (!sessionId) throw new Error('samClient.segment: no AI session');

    const res = await postJson<{
      mask_png_base64: string;
      width: number;
      height: number;
      model: string;
    }>('/segment/decode', {
      session_id: sessionId,
      prompts: args.prompts,
    });

    const { data, width, height } = await maskPngBase64ToBytes(res.mask_png_base64);
    return maskStore.register({
      layerId: args.layerId,
      label: args.label,
      width,
      height,
      data,
      source: args.prompts.length > 1
        ? 'sam-points'
        : args.prompts[0]?.kind === 'box'
        ? 'sam-box'
        : 'sam-point',
      prompts: args.prompts,
      createdAt: Date.now(),
    });
  },
};
```

Notes:
- The function signature (`ensureEmbedding(layerId)` and `segment({ layerId, prompts, label? })`) is the same as before — the four selection tools that call this don't change.
- `layerId` is no longer used by `ensureEmbedding` (the backend identifies images by session, not layer). The parameter is kept for backwards compatibility with the call sites; underscore-prefixed to silence lints.
- `maskPngBase64ToBytes` is exported so `useImageContext.ts` can reuse it when ingesting region masks (Task 9).

- [ ] **Step 2: Run check**

```bash
npm run check
```
Expected: PASS (0 errors). The breakage from Task 7 is now resolved.

- [ ] **Step 3: Commit Tasks 7 + 8 together**

```bash
git add package.json package-lock.json src/lib/sam/sam-client.ts
git rm src/lib/sam/model-loader.ts src/workers/sam.worker.ts
git commit -m "refactor(sam): replace ONNX runtime with backend HTTP client"
```

---

## Task 9 — Register region masks in `useImageContext`

**Files:**
- Modify: `src/types/image-context.ts`
- Modify: `src/lib/image-context-schema.ts`
- Modify: `src/hooks/useImageContext.ts`

- [ ] **Step 1: Extend the TypeScript type**

In `src/types/image-context.ts`, find `CandidateRegion`. Add `mask?` field:

```ts
export interface RegionMask {
  pngBase64: string;
  width: number;
  height: number;
}

export interface CandidateRegion {
  label: string;
  description: string;
  bbox?: number[];
  representativePoint?: number[];
  mask?: RegionMask;        // NEW — populated by backend after SAM refinement
  maskRef?: string;         // NEW — frontend-only; set after registering in maskStore
}
```

- [ ] **Step 2: Update the Zod schema in `src/lib/image-context-schema.ts`**

Read the file first. The schema does snake_case→camelCase conversion. Add the mask field to both the wire schema and the converter:

```ts
// Add to the existing schema definitions:
const RegionMaskSchema = z.object({
  png_base64: z.string(),
  width: z.number(),
  height: z.number(),
});

// Inside the CandidateRegion wire schema:
mask: RegionMaskSchema.optional(),

// In the conversion function (whatever fromWire / parseImageContext does):
mask: wireRegion.mask
  ? { pngBase64: wireRegion.mask.png_base64, width: wireRegion.mask.width, height: wireRegion.mask.height }
  : undefined,
```

Read the existing file to see exact conversion patterns and match them. The key constraint: TS interface uses `pngBase64`, JSON wire uses `png_base64`.

- [ ] **Step 3: Update `useImageContext.ts` to register region masks**

Find the function that handles the `/api/analyze` response (likely `uploadAndAnalyse` — look for `analyzeImage(sessionId)` call). After the context is received and BEFORE it's stored, iterate regions and register their masks:

```ts
import { maskStore } from '@/core/mask-store';
import { maskPngBase64ToBytes } from '@/lib/sam/sam-client';

// inside uploadAndAnalyse, after `const context = await analyzeImage(sessionId);`:
const activeLayerId = useEditorStore.getState().activeLayerId
  ?? useEditorStore.getState().layers.find((l) => l.type === 'image')?.id;

if (activeLayerId && context.candidateRegions) {
  for (const region of context.candidateRegions) {
    if (!region.mask) continue;
    try {
      const { data, width, height } = await maskPngBase64ToBytes(region.mask.pngBase64);
      const ref = maskStore.register({
        layerId: activeLayerId,
        label: region.label,
        width,
        height,
        data,
        source: 'ai-proposed',
        createdAt: Date.now(),
      });
      region.maskRef = ref;
    } catch (err) {
      console.error('[ImageContext] failed to register region mask:', region.label, err);
    }
  }
}
```

Make this an async loop that doesn't block the overall flow if a single mask fails.

The same registration should also happen in `restoreContext()` — when an `.edp` is loaded with cached context — so the masks survive a reload. Apply the same loop in that function.

- [ ] **Step 4: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/image-context.ts src/lib/image-context-schema.ts \
        src/hooks/useImageContext.ts
git commit -m "feat(ai): register backend-refined region masks in maskStore on analyse"
```

---

## Task 10 — Region pills in AI palette become clickable masks

**Files:**
- Modify: `src/components/AiCommandPalette.tsx`

- [ ] **Step 1: Add a click handler to the region pills**

Read the file to find where region pills are rendered (around lines 225-261 per the prior exploration). Each pill currently inserts `@label` into the prompt input on click. Extend the click to ALSO arm the mask if one is available.

Add a new helper near the top of the component:

```ts
const armMaskFromRegion = useCallback((region: CandidateRegion) => {
  if (!region.maskRef) return;
  useEditorStore.getState().setActiveMask(region.maskRef);
  useEditorStore.getState().commitMask();
}, []);
```

Then in the pill's `onClick`, add a single line BEFORE the existing `insertToken` (or however the prompt token gets inserted):

```ts
onClick={(e) => {
  if (e.shiftKey) {
    armMaskFromRegion(region);
    return;        // shift-click arms the mask only, doesn't insert the token
  }
  // ... existing behaviour (insert @label into prompt)
}}
```

**Behaviour rationale:** plain click keeps current behaviour (insert `@label`); shift-click is the explicit "use this region as a selection" action. This is non-destructive — existing users see no change unless they shift-click.

Add a small tooltip text to the pill so users know about shift-click: `title="Click to add to prompt · Shift-click to use as selection"`.

- [ ] **Step 2: Run check**

```bash
npm run check
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/AiCommandPalette.tsx
git commit -m "feat(palette): shift-click region pill arms its SAM-refined mask"
```

---

## Task 11 — Manual smoke test (deferred to user)

**Files:** none.

Plan A.5 cannot be smoke-tested by an automated subagent (no browser, no backend running). The user performs the verification on the running dev server.

- [ ] **Step 1: User starts the backend**

```bash
cd backend && source .venv/bin/activate
pip install -r requirements.txt           # pulls torch + segment-anything if not done
./scripts/download_sam.sh                  # one-time checkpoint fetch
uvicorn app.main:app --reload --host 127.0.0.1 --port 8787
```

Expected: `Uvicorn running on http://127.0.0.1:8787`. First request to a SAM endpoint will spend 1–5 s loading the model onto MPS (Apple Silicon) or CPU.

- [ ] **Step 2: User starts the frontend**

```bash
npm run dev
```

- [ ] **Step 3: Open an image**

Click "Open Image" → pick a file. `/api/session` then `/api/analyze` fire. Watch the backend logs — the analyze call should take ~3–5 s for Claude, then another ~1–2 s for SAM (encode + 8 region decodes).

DevTools console check:
```js
useEditorStore.getState().layers[0].id      // → image layer id
maskStore.all().filter(m => m.source === 'ai-proposed').length  // → number of regions with masks
```

Expected: the mask count equals `useAiSession.getState().context.candidateRegions.length`.

- [ ] **Step 4: Press P (SelectPoint), click the image**

Expected: <500 ms later a magenta tint appears (the SAM-refined mask), and the `SegmentActionsBar` shows up with Extract / Edit with AI / Scope / Discard.

- [ ] **Step 5: Press Cmd+K, shift-click a region pill**

Expected: the palette closes, the `SegmentActionsBar` appears immediately with that region pre-armed (no SAM call needed — it was bundled with `/api/analyze`).

- [ ] **Step 6: Click "Extract layer"**

Expected: a new branched layer appears in the layers panel; the graph editor shows a branch; the canvas composite shows only the masked region.

- [ ] **Step 7: If everything works, no commit is needed.** If small adjustments were required during smoke test, commit them as `chore(sam): plan A.5 smoke-test polish` with a short message.

---

## Self-review checklist

- [ ] **Spec coverage:**
  - Decision 1 (SAM on backend) → Tasks 3, 4, 5
  - Decision 2 (segment-anything ViT-B + MPS) → Task 3
  - Decision 3 (two endpoints, embedding cached) → Tasks 3, 5
  - Decision 4 (embed idempotent) → Task 3 `test_embed_caches_per_session`
  - Decision 5 (bundle region masks into `/api/analyze`) → Task 6
  - Decision 6 (base64 PNG transport) → Tasks 2, 5, 8
  - Decision 7 (frontend Plan A preserved except 3 SAM files) → Tasks 7, 8, 9, 10
  - Bonus (region pills clickable) → Task 10

- [ ] **Placeholder scan:** No "TBD" / "implement later" in the plan body. Step 3 of Task 9 says "Read the existing file to see exact conversion patterns and match them" — this is a real instruction (the engineer must inspect the existing file), not a placeholder.

- [ ] **Type consistency:**
  - `RegionMask` shape: `{ png_base64: str; width: int; height: int }` on the wire; `{ pngBase64: string; width: number; height: number }` in TS. Conversion happens in image-context-schema.ts (Task 9).
  - `samClient.ensureEmbedding(layerId)` and `samClient.segment({ layerId, prompts, label? })` signatures unchanged from Plan A — call sites in the four selection tools don't need updates.
  - `SamClient` (Python) — methods `embed`, `decode_point`, `decode_box` consistent across Task 3 (impl), Task 5 (consumer), Task 6 (analyze consumer).
  - `MaskSource = 'ai-proposed'` value used in Task 9 matches the union defined in Plan A's `mask-store.ts`.

- [ ] **Every code-bearing step has actual code.** ✓
- [ ] **Every task ends in a commit** (Task 11 is the exception — it's a verification task). ✓

## Out of scope (deferred)

- Multi-user backend deployment (single-active-session embedding cache is fine for thesis n≈12)
- ONNX export for production
- ViT-H by default (env-var opt-in already in Task 1's config)
- Streaming `/api/analyze` response (current shape returns all masks at once)
- Three-up mask candidates per click (best-IoU only)
- Brush refinement of `ai-proposed` masks via prompt update (manual brush-mask-tool covers it)
