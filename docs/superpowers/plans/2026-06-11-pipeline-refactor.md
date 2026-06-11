# Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the analyze pipeline end-to-end: split the mega-tool into 3–4 small tools, unify wire/store casing to a single camelCase shape, eliminate cross-phase pydantic mutation, persist sessions to disk, and move SAM into the browser via MobileSAM — with no functional regressions and aggressive legacy-code deletion.

**Architecture:** Five sequential phases, each independently shippable and reviewable. Phase 0 locks behavior with contract tests. Phase 1 unifies casing (foundation for everything after). Phase 2 splits `analyze_image` into pure, return-only tools. Phase 3 persists sessions. Phase 4 moves SAM to the browser via MobileSAM/WebGPU, deprecates backend SAM precompute. Every phase deletes more code than it adds.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest, OpenCV; TypeScript strict, React 19, Vite, Zustand, Vitest, ONNX Runtime Web + WebGPU.

---

## Big-picture before/after

### Before

```
analyze_image (one mega-tool, 4–10s)
├── prepare:     cv2 + SAM-encoder + Claude.analyze       (parallel)
├── soft fields: Claude.augment_context                   (sequential)
├── region_stats: cv2                                     (sequential)
├── mask precompute: SAM.decode_box × N                   (parallel, MUTATES regions)
└── widgets:     Claude.suggest_fused + N × resolve_fused (sequential, MUTATES doc)

backend wire = snake_case          frontend useAiSession = camelCase (Zod-parsed)
backend snapshot = snake_case      frontend snapshot     = snake_case (cast)
sessions = TTL in-memory           lost on backend restart
backend SAM = box-prompted on downscaled image, no refinement
```

### After

```
prepare_image     (cv2 + SAM-encoder, no LLM, fast)         — pure, returns PrepareResult
analyze_context   (Claude.analyze + soft_fields + stats)    — pure, returns Context
precompute_regions  [DEPRECATED end of Phase 4 — kept as a fallback only]
suggest_widgets   (Claude.suggest + N × resolve_fused)       — pure, fire-and-forget

backend wire = camelCase (pydantic aliases)
frontend store = single camelCase shape; EnrichedImageContext deleted
sessions = persisted to backend/.sessions/ (disk JSON + image blob)
SAM moves to browser: MobileSAM encoder cached per imageNodeId, decoder ~20ms/click
new propose_mask MCP tool for client-side mask commits
```

### Files this plan deletes outright

- `src/types/enriched-context.ts` (Phase 1)
- `src/lib/image-context-schema.ts` (Phase 1, partially – the conversion logic; the file is repurposed as a passthrough validator)
- `src/hooks/useImageContextFull.ts` (Phase 1, merged into `useImageContext.ts`)
- `backend/app/tools/atomic/analyze_image.py` (Phase 2)
- `src/lib/segmentation/segment-store.ts` (Phase 4 — replaced by per-imageNodeId SAM state store)
- `src/hooks/useSegmentInteraction.ts` (Phase 4 — the bridge is no longer needed)
- `backend/app/tools/atomic/precompute_regions.py` (Phase 4 — superseded by browser SAM; kept as a small fallback or removed entirely if no caller remains)

### Files this plan adds

- `backend/tests/contract/test_pipeline_envelope.py` (Phase 0)
- `backend/app/tools/atomic/prepare_image.py` (Phase 2)
- `backend/app/tools/atomic/analyze_context.py` (Phase 2)
- `backend/app/tools/atomic/precompute_regions.py` (Phase 2, deprecated in Phase 4)
- `backend/app/tools/atomic/suggest_widgets.py` (Phase 2)
- `backend/app/tools/atomic/propose_mask.py` (Phase 4)
- `backend/app/services/disk_session_store.py` (Phase 3)
- `src/lib/segmentation/mobile-sam-client.ts` (Phase 4)
- `src/lib/segmentation/mobile-sam-types.ts` (Phase 4)
- `src/hooks/useMobileSam.ts` (Phase 4)
- `public/models/mobile-sam/encoder.onnx`, `decoder.onnx` (Phase 4)

---

## Phase 0: Lock current behavior with contract tests

**Why:** Every subsequent phase rewrites either the wire shape, the call graph, or the state ownership. Without a contract test pinning the observable surface, regressions go undetected and the work becomes an opinion exercise.

We do NOT golden-test Claude output (network, cost, non-deterministic). We DO golden-test:
- Tool envelope shape from `analyze_image`
- SSE event sequence emitted during analyze
- `/api/state/{sid}` response shape after analyze
- Frontend `useAiSession.context` shape after `runAnalyse`

All Anthropic calls are monkey-patched.

### Task 0.1: Backend contract test for analyze envelope shape

**Files:**
- Create: `backend/tests/contract/__init__.py`
- Create: `backend/tests/contract/test_pipeline_envelope.py`
- Create: `backend/tests/contract/_fixtures.py`

- [ ] **Step 1: Create the contract test scaffolding**

```bash
mkdir -p backend/tests/contract
touch backend/tests/contract/__init__.py
```

- [ ] **Step 2: Write a fixtures module that fakes Anthropic + SAM**

Create `backend/tests/contract/_fixtures.py`:

```python
"""Shared fakes for pipeline contract tests.

These tests verify the observable wire shape across the analyze pipeline.
They MUST NOT call Anthropic, MUST NOT load SAM weights, and MUST be
deterministic. Every external dependency is monkey-patched here.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.schemas.image_context import CandidateRegion, ImageContext


_CANNED_CONTEXT = ImageContext(
    subjects=["a person"],
    lighting="flat",
    dominant_tones=["midtones"],
    mood="neutral test",
    candidate_regions=[
        CandidateRegion(
            label="person",
            description="The subject.",
            bbox=[0.1, 0.1, 0.6, 0.8],
            representative_point=[0.4, 0.5],
        ),
        CandidateRegion(
            label="background",
            description="Behind the subject.",
            bbox=[0.0, 0.0, 1.0, 1.0],
            representative_point=[0.05, 0.05],
        ),
    ],
    model_name="claude-haiku-4-5-test",
    model_version="test",
    generated_at="2026-06-11T00:00:00Z",
)


@pytest.fixture
def fake_anthropic(monkeypatch):
    """Replace every Claude call used by the analyze pipeline with a canned
    return that matches the production response shape."""
    from app.services import anthropic_client

    def _analyze(*_args, **_kwargs):
        return _CANNED_CONTEXT.model_copy(deep=True)

    def _augment(*_args, **_kwargs):
        # Internal type at backend/app/services/anthropic_client.py:201.
        # Re-imported here because the fixture mirrors the production return.
        from app.services.anthropic_client import _ContextSoftFields

        return _ContextSoftFields(
            estimated_white_point=(0.5, 0.5, 0.5),
            wb_neutral_confidence=0.8,
            grade_character="neutral",
            problems=[],
            region_soft_fields=[],
        )

    def _suggest(*_args, **_kwargs):
        return []  # no autonomous suggestions in tests

    monkeypatch.setattr(anthropic_client.AnthropicClient, "analyze_image", _analyze)
    monkeypatch.setattr(
        anthropic_client.AnthropicClient, "augment_context_soft_fields", _augment,
    )
    monkeypatch.setattr(
        anthropic_client.AnthropicClient,
        "suggest_fused_tools_for_character",
        _suggest,
    )


@pytest.fixture
def fake_sam(monkeypatch):
    """Replace the SAM client with a deterministic dummy that returns a
    centered rectangular mask for any bbox prompt. Keeps tests off the
    GPU and reproducible across runs."""
    from app.services import sam_client

    class _DummySam:
        def embed(self, _sid, _arr):
            return None

        def decode_box(self, _sid, pixel_bbox):
            x1, y1, x2, y2 = pixel_bbox.astype(int)
            h = max(int(y2) + 1, 4)
            w = max(int(x2) + 1, 4)
            mask = np.zeros((h, w), dtype=bool)
            mask[y1:y2, x1:x2] = True
            return mask

    monkeypatch.setattr(sam_client, "SamClient", _DummySam)
    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _DummySam())
```

- [ ] **Step 3: Write the failing envelope-shape test**

Create `backend/tests/contract/test_pipeline_envelope.py`:

```python
"""Contract tests: the analyze tool envelope and snapshot shape.

These pin the OBSERVABLE wire shape so subsequent refactor phases catch
regressions. They are deliberately structural (key presence + types),
not value-based, so they survive Phase 1's casing migration with a
single search/replace.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from tests.contract._fixtures import fake_anthropic, fake_sam  # noqa: F401


def _post_session(client: TestClient) -> str:
    with open("backend/tests/fixtures/test_image.jpg", "rb") as f:
        resp = client.post("/api/session", files={"image": f})
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


def test_analyze_envelope_shape(
    fake_anthropic, fake_sam, monkeypatch
):
    """The analyze_image tool envelope must carry the keys the frontend
    consumes. Values are not asserted; this is a shape contract."""
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)

    resp = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    out = body["output"]
    # Top-level keys the frontend reads (snake_case under current contract).
    for key in (
        "subjects",
        "lighting",
        "dominant_tones",
        "mood",
        "candidate_regions",
        "model_name",
        "model_version",
        "generated_at",
    ):
        assert key in out, f"missing top-level key: {key}"
    assert isinstance(out["candidate_regions"], list)
    assert len(out["candidate_regions"]) >= 1
    region = out["candidate_regions"][0]
    for key in ("label", "description", "bbox", "representative_point"):
        assert key in region, f"missing region key: {key}"


def test_state_snapshot_shape(fake_anthropic, fake_sam, monkeypatch):
    """The /api/state/{sid} snapshot must surface image_context with the
    same regions list. Pins the SSE-merged shape consumers depend on."""
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})

    snap = client.get(f"/api/state/{sid}").json()
    for key in ("session_id", "image_context", "widgets", "masks_index"):
        assert key in snap
    ic = snap["image_context"]
    assert ic is not None
    assert "candidate_regions" in ic
    assert isinstance(ic["candidate_regions"], list)
```

- [ ] **Step 4: Run the contract tests, expect PASS against current code**

```bash
cd backend && pytest tests/contract/ -v
```

Expected: both tests PASS. (They pin existing behavior. If they fail now, the canned fakes are wrong — investigate.)

- [ ] **Step 5: Commit**

```bash
git add backend/tests/contract/
git commit -m "test: contract tests for analyze pipeline envelope + snapshot shape"
```

### Task 0.2: Frontend contract test for useAiSession shape

**Files:**
- Create: `src/hooks/useImageContext.contract.test.ts`

- [ ] **Step 1: Write the contract test**

Create `src/hooks/useImageContext.contract.test.ts`:

```typescript
/**
 * Contract test: useAiSession.context shape after a successful runAnalyse.
 * Pins the camelCase frontend shape so later refactors (Phase 1 casing
 * unification, Phase 2 tool split) don't silently drop fields.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useAiSession } from './useImageContext';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    analyze_image: vi.fn(async () => ({
      ok: true,
      output: {
        subjects: ['a person'],
        lighting: 'flat',
        dominant_tones: ['midtones'],
        mood: 'test',
        candidate_regions: [
          {
            label: 'person',
            description: 'The subject.',
            bbox: [0.1, 0.1, 0.6, 0.8],
            representative_point: [0.4, 0.5],
            paths: [[[0.1, 0.1], [0.6, 0.1], [0.6, 0.8], [0.1, 0.8]]],
            mask_png_base64: 'iVBORw0KGgoAAAA=',
          },
        ],
        model_name: 'test',
        model_version: '1',
        generated_at: '2026-06-11T00:00:00Z',
      },
    })),
  },
}));

vi.mock('@/lib/sam/sam-client', () => ({
  maskPngBase64ToBytes: vi.fn(async () => ({
    data: new Uint8Array(16),
    width: 4,
    height: 4,
  })),
}));

vi.mock('@/core/pixel-store', () => ({
  pixelStore: {
    getSource: vi.fn(() => ({ width: 100, height: 100 })),
  },
}));

vi.mock('@/core/mask-store', () => ({
  maskStore: {
    get: vi.fn(() => null),
    register: vi.fn(() => 'mask-ref-1'),
  },
}));

vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ setSnapshot: vi.fn() }) },
}));

describe('useAiSession contract', () => {
  beforeEach(() => {
    useAiSession.setState({
      sessionId: 'sid-1',
      context: null,
      status: 'idle',
      error: null,
    });
  });

  afterEach(() => {
    useAiSession.getState().reset();
  });

  it('runAnalyse populates context with camelCase fields', async () => {
    await useAiSession.getState().runAnalyse();
    const ctx = useAiSession.getState().context;
    expect(ctx).not.toBeNull();
    expect(ctx).toEqual(
      expect.objectContaining({
        subjects: expect.any(Array),
        lighting: expect.any(String),
        dominantTones: expect.any(Array),
        mood: expect.any(String),
        candidateRegions: expect.any(Array),
        modelName: expect.any(String),
        modelVersion: expect.any(String),
        generatedAt: expect.any(String),
      }),
    );
    const region = ctx!.candidateRegions![0];
    expect(region).toEqual(
      expect.objectContaining({
        label: expect.any(String),
        description: expect.any(String),
        bbox: expect.any(Array),
        representativePoint: expect.any(Array),
        paths: expect.any(Array),
        maskPngBase64: expect.any(String),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test, expect PASS against current code**

```bash
npx vitest run src/hooks/useImageContext.contract.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useImageContext.contract.test.ts
git commit -m "test: contract test for useAiSession camelCase shape"
```

---

## Phase 1: Unify casing — single camelCase shape, one store

**Why:** Two parallel context shapes (snake on snapshot, camel on useAiSession) live in the codebase. The bug we hit on 2026-06-10 (`envelope.output as unknown as ImageContext` casting snake to camel) was a direct symptom. Pick one shape end-to-end. We pick **camelCase on the wire**, achieved by pydantic alias generators, because the frontend has more consumers than the backend has emitters.

**Outcome:**
- Backend models emit camelCase on `.model_dump(mode="json", by_alias=True)`
- One `ImageContext` interface in the frontend, used by every consumer
- `useImageContextFull` collapses into a selector on `useAiSession`, or is deleted entirely
- Zod conversion drops to a pass-through validator
- Delete: `src/types/enriched-context.ts`, `src/hooks/useImageContextFull.ts`

### Task 1.1: Add a camelCase alias generator to backend pydantic models

**Files:**
- Create: `backend/app/schemas/_camel.py`
- Modify: `backend/app/schemas/image_context.py`
- Modify: `backend/app/schemas/enriched_context.py`
- Modify: `backend/app/schemas/widget.py`
- Modify: `backend/app/schemas/operation_graph.py`
- Modify: `backend/app/state/snapshot.py`
- Test: existing `backend/tests/test_schemas.py` + contract tests from Phase 0

- [ ] **Step 1: Write the alias-generator helper**

Create `backend/app/schemas/_camel.py`:

```python
"""Shared pydantic ConfigDict that emits camelCase on the wire but still
accepts snake_case input (for tests + .edp files that predate the migration).

Usage:
    class CandidateRegion(BaseModel):
        model_config = camel_config(extra="forbid")
        candidate_regions: list[...] = Field(default_factory=list)

After this, `model.model_dump(mode="json", by_alias=True)` emits
`candidateRegions`. The default `model_dump()` (no by_alias) still emits
snake_case so internal Python callers are unaffected.
"""

from __future__ import annotations

from typing import Any

from pydantic import ConfigDict


def _to_camel(snake: str) -> str:
    head, *tail = snake.split("_")
    return head + "".join(part.capitalize() for part in tail)


def camel_config(**overrides: Any) -> ConfigDict:
    base: dict[str, Any] = dict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )
    base.update(overrides)
    return ConfigDict(**base)  # type: ignore[arg-type]
```

- [ ] **Step 2: Write a unit test for the helper**

Append to `backend/tests/test_schemas.py`:

```python
def test_camel_config_round_trip():
    from pydantic import BaseModel, Field

    from app.schemas._camel import camel_config

    class Sample(BaseModel):
        model_config = camel_config(extra="forbid")
        first_name: str
        last_name: str | None = None
        nested_items: list[int] = Field(default_factory=list)

    obj = Sample(first_name="A", last_name="B", nested_items=[1, 2])
    # Default dump: snake
    assert obj.model_dump() == {
        "first_name": "A",
        "last_name": "B",
        "nested_items": [1, 2],
    }
    # by_alias dump: camel
    assert obj.model_dump(by_alias=True) == {
        "firstName": "A",
        "lastName": "B",
        "nestedItems": [1, 2],
    }
    # Round-trip from camel input
    again = Sample.model_validate({"firstName": "A", "lastName": "B", "nestedItems": [1, 2]})
    assert again.last_name == "B"
    # Round-trip from snake input still works (populate_by_name=True)
    again2 = Sample.model_validate({"first_name": "X"})
    assert again2.first_name == "X"
```

- [ ] **Step 3: Run the helper test, expect PASS**

```bash
cd backend && pytest tests/test_schemas.py::test_camel_config_round_trip -v
```

Expected: PASS.

- [ ] **Step 4: Apply the alias config to every wire model**

Edit `backend/app/schemas/image_context.py`. Replace each `model_config = ConfigDict(extra="forbid"…)` line:

```python
# Top of file:
from app.schemas._camel import camel_config

# class CandidateRegion:
class CandidateRegion(BaseModel):
    model_config = camel_config(extra="forbid")
    # …existing fields unchanged

# class ImageContext:
class ImageContext(BaseModel):
    model_config = camel_config(extra="forbid", protected_namespaces=())
    # …existing fields unchanged

# class SamPromptSet, RegionRefinement, ContextRefinements, RegionLabel:
# Replace ConfigDict(extra="forbid") with camel_config(extra="forbid").
```

Repeat for `backend/app/schemas/enriched_context.py`, `backend/app/schemas/widget.py`, `backend/app/schemas/operation_graph.py`. Every `BaseModel` whose instances are serialized to the wire gets `camel_config(...)`.

- [ ] **Step 5: Update every wire-emitting serializer to pass by_alias=True**

Search for every `.model_dump(mode="json"` call in `backend/app/` (this catches the SSE emits, the tool envelope, the snapshot, the session_store payload):

```bash
grep -rn 'model_dump(mode="json"' backend/app
```

Edit each call site to `model_dump(mode="json", by_alias=True)`. Common targets:

- `backend/app/tools/atomic/analyze_image.py` (multiple sites)
- `backend/app/state/snapshot.py`
- `backend/app/services/anthropic_client.py` (if any)
- `backend/app/api/state.py`

Leave internal-only calls (e.g. `set_context` if that store is never round-tripped to disk; check before touching).

- [ ] **Step 6: Run the contract tests, expect FAIL on snake-case key assertions**

```bash
cd backend && pytest tests/contract/ -v
```

Expected: FAIL — Phase 0 tests assert `candidate_regions`, the wire now emits `candidateRegions`.

- [ ] **Step 7: Update the contract tests to assert camelCase**

Edit `backend/tests/contract/test_pipeline_envelope.py`. Search/replace the asserted key list:

- `subjects` → unchanged
- `lighting` → unchanged
- `dominant_tones` → `dominantTones`
- `mood` → unchanged
- `candidate_regions` → `candidateRegions`
- `model_name` → `modelName`
- `model_version` → `modelVersion`
- `generated_at` → `generatedAt`
- region keys: `representative_point` → `representativePoint`

- [ ] **Step 8: Run contract + schemas tests, expect PASS**

```bash
cd backend && pytest tests/contract/ tests/test_schemas.py -v
```

Expected: PASS.

- [ ] **Step 9: Run the full backend test suite**

```bash
cd backend && pytest -q
```

Expected: any failure is in a test that hardcodes snake-case wire keys. Triage each:
- If a test asserts snake-case wire shape, update it to camelCase (this is now the contract).
- If a test passes snake-case INPUT to a model (e.g. `CandidateRegion(**snake_dict)`), it should still pass because `populate_by_name=True` accepts both — investigate any failure.

- [ ] **Step 10: Commit**

```bash
git add backend/app/schemas/_camel.py \
        backend/app/schemas/image_context.py \
        backend/app/schemas/enriched_context.py \
        backend/app/schemas/widget.py \
        backend/app/schemas/operation_graph.py \
        backend/app/state/snapshot.py \
        backend/app/tools/atomic/analyze_image.py \
        backend/app/api/state.py \
        backend/tests/contract/test_pipeline_envelope.py \
        backend/tests/test_schemas.py
git commit -m "refactor(schemas): emit camelCase on the wire via pydantic alias generator"
```

### Task 1.2: Delete the frontend EnrichedImageContext mirror

**Files:**
- Delete: `src/types/enriched-context.ts`
- Delete: `src/hooks/useImageContextFull.ts`
- Modify: `src/types/image-context.ts` — extend with the fields previously only on EnrichedImageContext
- Modify: `src/store/backend-state-slice.ts` — snapshot.image_context becomes the camelCase ImageContext
- Modify: every consumer of `useImageContextFull` and snake-case fields

- [ ] **Step 1: Extend ImageContext to carry the enriched fields**

Edit `src/types/image-context.ts`. Add the fields that EnrichedImageContext had but ImageContext didn't:

```typescript
// Existing imports stay.

export interface ColorSwatchData {
  rgb: [number, number, number];
  weight: number;
}

export type ProblemKind =
  | 'clipped_highlights'
  | 'crushed_shadows'
  | 'low_contrast'
  | 'strong_color_cast'
  | 'noisy_shadows'
  | 'uneven_white_balance';

export interface Problem {
  kind: ProblemKind;
  severity: number;
  regionLabel?: string | null;
  bbox?: [number, number, number, number] | null;
  suggestedFusedTools: string[];
}

export interface RegionStats {
  label: string;
  pixelCount: number;
  meanLuma: number;
  lumaHistogram: number[];
  meanRgb: [number, number, number];
  dominantSwatches: ColorSwatchData[];
  isSkinLikely: boolean;
  isSkyLikely: boolean;
  saturationMean: number;
  contrastP10P90: number;
}

export interface ImageContext {
  // Existing fields:
  subjects: string[];
  lighting: 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
  dominantTones: ('shadows' | 'midtones' | 'highlights')[];
  mood: string;
  candidateRegions: CandidateRegion[];
  modelName: string;
  modelVersion: string;
  generatedAt: string;

  // Enriched fields (previously on EnrichedImageContext):
  lumaHistogram?: number[];
  // Backend ships `dict[str, list[int]]` keyed by 'r'/'g'/'b'.
  rgbHistograms?: Record<string, number[]>;
  clippedShadowsPct?: number;
  clippedHighlightsPct?: number;
  medianLuma?: number;
  contrastP10P90?: number;
  colorPalette?: ColorSwatchData[];
  castStrength?: number;
  castDirection?: [number, number];
  regionStats?: RegionStats[];
  // Backend type is tuple[float, float, float] — RGB of the neutral pixel.
  estimatedWhitePoint?: [number, number, number];
  wbNeutralConfidence?: number;
  gradeCharacter?: string;
  problems?: Problem[];
}
```

The existing `CandidateRegion` interface stays as-is — it already has `maskRef`, `maskPngBase64`, `paths`, etc. on camelCase.

- [ ] **Step 2: Delete `src/types/enriched-context.ts`**

```bash
git rm src/types/enriched-context.ts
```

- [ ] **Step 3: Update every importer of EnrichedImageContext to use ImageContext**

Find imports:

```bash
grep -rn "from '@/types/enriched-context'" src --include="*.ts" --include="*.tsx"
```

Expected hits (typical):
- `src/hooks/useImageContextFull.ts` — about to be deleted, ignore
- `src/components/inspector/info/InfoTab.tsx`
- `src/components/inspector/info/RegionsSection.tsx`
- `src/components/inspector/info/SemanticSection.tsx`
- `src/components/inspector/info/__fixtures__/enriched-context.ts`
- `src/store/backend-state-slice.ts`

For each hit:
1. Change import: `import type { ImageContext } from '@/types/image-context';`
2. Replace `EnrichedImageContext` with `ImageContext` in the file
3. Convert snake_case field reads to camelCase:
   - `ctx.candidate_regions` → `ctx.candidateRegions`
   - `ctx.dominant_tones` → `ctx.dominantTones`
   - `ctx.model_name` → `ctx.modelName`
   - `ctx.model_version` → `ctx.modelVersion`
   - `ctx.generated_at` → `ctx.generatedAt`
   - `ctx.estimated_white_point` → `ctx.estimatedWhitePoint`
   - `ctx.wb_neutral_confidence` → `ctx.wbNeutralConfidence`
   - `ctx.grade_character` → `ctx.gradeCharacter`
   - `ctx.luma_histogram` → `ctx.lumaHistogram`
   - `ctx.rgb_histograms` → `ctx.rgbHistograms`
   - `ctx.clipped_shadows_pct` → `ctx.clippedShadowsPct`
   - `ctx.clipped_highlights_pct` → `ctx.clippedHighlightsPct`
   - `ctx.median_luma` → `ctx.medianLuma`
   - `ctx.contrast_p10_p90` → `ctx.contrastP10P90`
   - `ctx.color_palette` → `ctx.colorPalette`
   - `ctx.cast_strength` → `ctx.castStrength`
   - `ctx.cast_direction` → `ctx.castDirection`
   - `ctx.region_stats` → `ctx.regionStats`
   - Inside region: `r.region_label` → `r.regionLabel`; `r.suggested_fused_tools` → `r.suggestedFusedTools`

- [ ] **Step 4: Update the fixture file**

Edit `src/components/inspector/info/__fixtures__/enriched-context.ts`. Rename keys to camelCase to match the new ImageContext shape. Consider renaming the file to `image-context.ts` for clarity (`git mv`).

- [ ] **Step 5: Delete `src/hooks/useImageContextFull.ts`**

It was a thin wrapper around `useBackendState.snapshot.image_context` cast to EnrichedImageContext. Now `useBackendState.snapshot.image_context` IS ImageContext, so the hook is a one-liner the caller can inline, or — better — a re-export from `useImageContext.ts`. Pick the cleaner one:

Edit `src/hooks/useImageContext.ts` to add:

```typescript
/**
 * Read the latest analysis context from the backend snapshot. Replaces
 * the deleted `useImageContextFull`. Prefer this over `useAiSession.context`
 * when you want SSE-merged partial updates (e.g. soft fields arriving
 * mid-analyze); use `useAiSession.context` when you want the final
 * post-runAnalyse value.
 */
export function useImageContextSnapshot(): ImageContext | null {
  return useBackendState((s) => s.snapshot?.image_context ?? null);
}
```

Then:

```bash
git rm src/hooks/useImageContextFull.ts
```

Update every importer of `useImageContextFull` to import `useImageContextSnapshot` from `@/hooks/useImageContext`.

- [ ] **Step 6: Update backend-state-slice context.updated handler**

Edit `src/store/backend-state-slice.ts`. The SSE `context.updated` partial payload now arrives camelCase. The merge logic stays identical (spread). Update the type cast at the call site:

```typescript
const partial = payload.image_context as
  | Partial<NonNullable<SessionStateSnapshot['image_context']>>
  | undefined;
```

This already references the snapshot's image_context type, which now resolves to `ImageContext`. No code change needed if you used the type — verify by typechecking. If a hard-coded snake-case key appears (e.g. partial `?.region_stats`), update to camelCase.

- [ ] **Step 7: Delete the Zod parse in runAnalyse**

Edit `src/hooks/useImageContext.ts`. The envelope output is now camelCase, matching ImageContext directly. Replace:

```typescript
const context = ImageContextSchema.parse(envelope.output);
```

with:

```typescript
const context = envelope.output as ImageContext;
```

The cast is now safe — the runtime shape matches the type. Keep the runtime safety net as a `dev`-only assertion if you want belt-and-braces:

```typescript
if (import.meta.env.DEV) {
  // Surface drift early in dev; production trusts the wire.
  if (!Array.isArray(context.candidateRegions)) {
    console.warn('[useImageContext] envelope missing candidateRegions');
  }
}
```

- [ ] **Step 8: Simplify the Zod schema file (or delete it)**

`src/lib/image-context-schema.ts` exported `ImageContextSchema` for `analyzeImage` in `ai-client.ts`. Check if `analyzeImage` (legacy REST `/api/analyze` path) is still used:

```bash
grep -rn "analyzeImage\|from '@/lib/ai-client'" src --include="*.ts" --include="*.tsx" | grep -v ".test."
```

If only tests reference it, you can delete the legacy path. Otherwise:

- Convert `ImageContextSchema` to a pass-through that validates camelCase shape only, no transform.
- OR delete the schema file and have `analyzeImage` return `envelope.output as ImageContext` like `runAnalyse` does.

Pick option B if the legacy path has zero non-test callers (recommended — it's dead code). If it does have a caller, do option A:

```typescript
// src/lib/image-context-schema.ts
import { z } from 'zod';
import type { ImageContext } from '@/types/image-context';

// camelCase pass-through. The wire and the type now agree, so this is
// purely a runtime safety net — no key renaming.
const CandidateRegionSchema = z.object({
  label: z.string(),
  description: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  representativePoint: z.tuple([z.number(), z.number()]).optional(),
  paths: z.array(z.array(z.tuple([z.number(), z.number()]))).optional(),
  maskPngBase64: z.string().optional(),
  maskRef: z.string().optional(),
});

export const ImageContextSchema = z.object({
  subjects: z.array(z.string()),
  lighting: z.enum(['flat', 'backlit', 'side', 'rim', 'mixed']),
  dominantTones: z.array(z.enum(['shadows', 'midtones', 'highlights'])),
  mood: z.string(),
  candidateRegions: z.array(CandidateRegionSchema),
  modelName: z.string(),
  modelVersion: z.string(),
  generatedAt: z.string(),
}) as unknown as z.ZodType<ImageContext>;
```

- [ ] **Step 9: Update src/lib/ai-client.ts pushSessionContext**

Edit `src/lib/ai-client.ts`. The `pushSessionContext` function builds a snake-case payload because the OLD backend endpoint expected snake. With camelCase aliases on the backend and `populate_by_name=True`, the endpoint now accepts both, but emit camel to be consistent:

```typescript
export async function pushSessionContext(
  sessionId: string,
  context: ImageContext,
): Promise<void> {
  const body = {
    subjects: context.subjects,
    lighting: context.lighting,
    dominantTones: context.dominantTones,
    mood: context.mood,
    candidateRegions: context.candidateRegions.map((r) => ({
      label: r.label,
      description: r.description,
      bbox: r.bbox,
      representativePoint: r.representativePoint,
      paths: r.paths,
      maskPngBase64: r.maskPngBase64,
    })),
    modelName: context.modelName,
    modelVersion: context.modelVersion,
    generatedAt: context.generatedAt,
  };
  const resp = await fetch(`${BASE_URL}/api/session/${sessionId}/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`pushSessionContext failed: ${resp.status}`);
  }
}
```

- [ ] **Step 10: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean. If errors remain, they're missed snake_case field reads — fix them.

- [ ] **Step 11: Run the contract test**

```bash
npx vitest run src/hooks/useImageContext.contract.test.ts
```

Expected: PASS — the canned envelope is still snake-case in the test mock, but the backend now emits camel. Update the test mock to camelCase envelope:

```typescript
output: {
  subjects: ['a person'],
  lighting: 'flat',
  dominantTones: ['midtones'],
  mood: 'test',
  candidateRegions: [
    {
      label: 'person',
      description: 'The subject.',
      bbox: [0.1, 0.1, 0.6, 0.8],
      representativePoint: [0.4, 0.5],
      paths: [[[0.1, 0.1], [0.6, 0.1], [0.6, 0.8], [0.1, 0.8]]],
      maskPngBase64: 'iVBORw0KGgoAAAA=',
    },
  ],
  modelName: 'test',
  modelVersion: '1',
  generatedAt: '2026-06-11T00:00:00Z',
},
```

Re-run and expect PASS.

- [ ] **Step 12: Run the full frontend test suite**

```bash
npm run test:run
```

Triage failures: any test asserting snake-case keys updates to camelCase.

- [ ] **Step 13: Manual smoke test**

Restart backend (`npm run dev:backend`), open the app, load an image, run analyze. Verify:

- Backend log shows `candidateRegions` in `[ImageContext]` (the existing console.log).
- Inspector InfoTab shows regions list (it reads `useImageContextSnapshot()` now).
- Object mode shows "Objects · N" footer.
- Hover/click on a region still produces overlay + tooltip (no behavior regression).

- [ ] **Step 14: Commit**

```bash
git add src/types/image-context.ts \
        src/hooks/useImageContext.ts \
        src/lib/image-context-schema.ts \
        src/lib/ai-client.ts \
        src/store/backend-state-slice.ts \
        src/hooks/useImageContext.contract.test.ts \
        src/components/inspector/info/
git rm src/types/enriched-context.ts src/hooks/useImageContextFull.ts
git commit -m "refactor(frontend): single camelCase ImageContext, drop EnrichedImageContext mirror"
```

### Task 1.3: Phase 1 close — verify and clean up

- [ ] **Step 1: Search for remaining snake-case shrapnel**

```bash
grep -rn "candidate_regions\|representative_point\|mask_png_base64\|dominant_tones\|region_stats\|estimated_white_point\|wb_neutral_confidence\|grade_character" src --include="*.ts" --include="*.tsx" | grep -v ".test." | grep -v "// "
```

Expected: zero hits in non-test, non-comment code. Any remaining hit is a missed conversion — fix it.

- [ ] **Step 2: Run check (tsc + eslint + vitest)**

```bash
npm run check
```

Expected: PASS. Phase 1 is shippable.

- [ ] **Step 3: Tag the merge commit (optional, makes Phase 2 base obvious)**

```bash
git tag refactor-phase-1-done
```

---

## Phase 2: Split analyze_image + stop mutating models

**Why:** `analyze_image` is a 220-line mega-tool that does 6 phases of work, mutates `base_ctx.candidate_regions` and `doc.image_context` mid-flight, and gates user-visible analyze on the autonomous-widget-suggestion fan-out. Splitting into pure tools makes each phase independently testable, observable, and skippable.

**Outcome:**
- `analyze_image.py` deleted
- 4 new atomic tools, each pure (returns values, no model mutation)
- Frontend orchestrator calls them in sequence; precompute + suggest are fire-and-forget
- Backend test surface area drops because each tool is simpler in isolation

### Files

```
backend/app/tools/atomic/
├── prepare_image.py       (NEW) cv2 mechanical stats + SAM encoder embed
├── analyze_context.py     (NEW) Claude analyze + soft_fields + region_stats
├── precompute_regions.py  (NEW) SAM box-decode → list[(label, png, paths)]
├── suggest_widgets.py     (NEW) Claude suggest_fused + N × resolve_fused → list[Widget]
└── analyze_image.py       (DELETE at end of phase)

backend/app/tools/registry.py    (MODIFY) register new tools, drop old

src/hooks/useImageContext.ts     (MODIFY) runAnalyse orchestrates 4 calls
src/lib/backend-tools.ts         (MODIFY) typed surface for new tools
```

### Task 2.1: Extract pure helpers from analyze_image into a phases module

**Files:**
- Create: `backend/app/tools/atomic/_analyze_phases.py`
- Modify: `backend/app/tools/atomic/analyze_image.py` to import from it (temporary; lets the 4 new tools share logic)

- [ ] **Step 1: Write the phases module**

Create `backend/app/tools/atomic/_analyze_phases.py`. This file extracts the pure phase functions out of the current mega-tool so the new atomic tools can call them without duplication. Pure = no `doc` mutation, no SSE emit.

```python
"""Pure phase functions for the analyze pipeline.

Each function takes inputs, returns outputs, and never mutates a SessionDocument
or pydantic model that lives outside its own scope. This is the cleanup that
makes the 4-tool split possible: tools wire phases together, phases compute.
"""

from __future__ import annotations

import asyncio
import io
import time
from dataclasses import dataclass

import numpy as np
from PIL import Image

from app.api.analyze import _mask_to_paths
from app.schemas.enriched_context import EnrichedImageContext, RegionStats
from app.schemas.image_context import CandidateRegion, ImageContext
from app.schemas.widget import MaskRecord
from app.state.context_stats import CheapPassResult, compute_cheap_pass
from app.tools.atomic.select_by_point import _encode_mask_png_b64


@dataclass(frozen=True)
class PrepareResult:
    """Output of prepare_image: cheap mechanical stats + SAM embed status."""

    cheap: CheapPassResult
    sam_ok: bool
    image_width: int
    image_height: int


@dataclass(frozen=True)
class RegionMaskResult:
    """One pre-decoded SAM mask for a candidate region."""

    region_index: int
    mask_id: str
    mask_record: MaskRecord
    mask_png_base64: str
    paths: list[list[list[float]]]


def decode_image(image_bytes: bytes) -> tuple[np.ndarray, int, int]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    arr = np.asarray(img)
    return arr, arr.shape[1], arr.shape[0]


async def run_mechanical(arr: np.ndarray) -> CheapPassResult:
    """Cheap pass (cv2/numpy) on the source pixels. CPU-bound but fast."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, compute_cheap_pass, arr)


async def run_sam_embed(sam, session_id: str, arr: np.ndarray) -> bool:
    """SAM image-encoder pass. Returns True on success, False on failure."""
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, sam.embed, session_id, arr)
        return True
    except Exception:
        return False


async def decode_region_mask(
    sam,
    session_id: str,
    region_index: int,
    region: CandidateRegion,
    w_img: int,
    h_img: int,
) -> RegionMaskResult | None:
    """Run SAM box-decode for ONE region. Returns None on failure."""
    if region.bbox is None:
        return None
    import uuid

    x, y, w, h = region.bbox
    pixel_bbox = np.array(
        [x * w_img, y * h_img, (x + w) * w_img, (y + h) * h_img], dtype=np.float32
    )
    loop = asyncio.get_running_loop()
    try:
        mask = await loop.run_in_executor(
            None, lambda: sam.decode_box(session_id, pixel_bbox),
        )
    except Exception:
        return None
    mask_id = str(uuid.uuid4())
    png_b64 = _encode_mask_png_b64(mask)
    record = MaskRecord(
        id=mask_id,
        width=int(mask.shape[1]),
        height=int(mask.shape[0]),
        png_b64=png_b64,
        source="sam_box",
        label=region.label,
    )
    return RegionMaskResult(
        region_index=region_index,
        mask_id=mask_id,
        mask_record=record,
        mask_png_base64=png_b64,
        paths=_mask_to_paths(mask),
    )


def build_enriched(
    base: ImageContext,
    cheap: CheapPassResult,
    soft,
    region_stats: list[RegionStats],
) -> EnrichedImageContext:
    """Compose the EnrichedImageContext from pure inputs. No mutation: the
    caller owns the result; this function returns it."""
    return EnrichedImageContext(
        **base.model_dump(),
        luma_histogram=cheap.luma_histogram,
        rgb_histograms=cheap.rgb_histograms,
        clipped_shadows_pct=cheap.clipped_shadows_pct,
        clipped_highlights_pct=cheap.clipped_highlights_pct,
        median_luma=cheap.median_luma,
        contrast_p10_p90=cheap.contrast_p10_p90,
        color_palette=cheap.color_palette,
        cast_strength=cheap.cast_strength,
        cast_direction=cheap.cast_direction,
        region_stats=region_stats,
        estimated_white_point=soft.estimated_white_point,
        wb_neutral_confidence=soft.wb_neutral_confidence,
        grade_character=soft.grade_character,
        problems=soft.problems,
    )


def apply_region_masks(
    enriched: EnrichedImageContext,
    masks: list[RegionMaskResult],
) -> EnrichedImageContext:
    """Apply pre-decoded mask paths + PNG onto the regions. Returns a NEW
    EnrichedImageContext — does NOT mutate the input.

    The PNG and paths are mirrored onto `candidate_regions[i]` so the
    frontend's object-mode pipeline can read them directly (it does not
    pull from masks_index).
    """
    by_index = {m.region_index: m for m in masks}
    new_regions = []
    for i, r in enumerate(enriched.candidate_regions):
        m = by_index.get(i)
        if m is None:
            new_regions.append(r.model_copy())
            continue
        new_regions.append(
            r.model_copy(
                update={"mask_png_base64": m.mask_png_base64, "paths": m.paths},
            ),
        )
    return enriched.model_copy(update={"candidate_regions": new_regions})


def compute_region_stats(arr: np.ndarray, base: ImageContext, soft_fields) -> list[RegionStats]:
    """Run the existing region-stats computation. Pure wrapper that returns
    the list rather than mutating ctx."""
    from app.tools.atomic.analyze_image import _compute_region_stats

    return _compute_region_stats(arr, base, soft_fields)
```

- [ ] **Step 2: Write tests for the phases module**

Create `backend/tests/tools/test_analyze_phases.py`:

```python
"""Unit tests for the pure phase functions. Each test pins exact behavior
so the tool split is provably equivalent to the original mega-tool."""

import numpy as np
import pytest

from app.schemas.image_context import CandidateRegion, ImageContext


@pytest.fixture
def simple_arr():
    return np.zeros((128, 128, 3), dtype=np.uint8)


@pytest.fixture
def simple_context():
    return ImageContext(
        subjects=["x"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="m",
        candidate_regions=[
            CandidateRegion(
                label="r0",
                description="",
                bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
            ),
        ],
        model_name="t",
        model_version="1",
        generated_at="2026-06-11T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_run_sam_embed_returns_true_on_success():
    from app.tools.atomic._analyze_phases import run_sam_embed

    class _Sam:
        def embed(self, _sid, _arr):
            return None

    ok = await run_sam_embed(_Sam(), "sid", np.zeros((4, 4, 3), dtype=np.uint8))
    assert ok is True


@pytest.mark.asyncio
async def test_run_sam_embed_returns_false_on_exception():
    from app.tools.atomic._analyze_phases import run_sam_embed

    class _Sam:
        def embed(self, _sid, _arr):
            raise RuntimeError("boom")

    ok = await run_sam_embed(_Sam(), "sid", np.zeros((4, 4, 3), dtype=np.uint8))
    assert ok is False


@pytest.mark.asyncio
async def test_decode_region_mask_returns_none_when_bbox_missing(simple_context):
    from app.tools.atomic._analyze_phases import decode_region_mask

    region = simple_context.candidate_regions[0].model_copy(update={"bbox": None})
    out = await decode_region_mask(None, "sid", 0, region, 100, 100)
    assert out is None


def test_apply_region_masks_does_not_mutate_input(simple_context):
    """Critical contract: phase functions never mutate models in place.

    This locks in the no-mutation invariant Phase 2 is fundamentally about."""
    from app.schemas.enriched_context import EnrichedImageContext

    enriched = EnrichedImageContext(**simple_context.model_dump())
    original = enriched.model_dump()  # snapshot before
    from app.tools.atomic._analyze_phases import RegionMaskResult, apply_region_masks
    from app.schemas.widget import MaskRecord

    fake_mask = RegionMaskResult(
        region_index=0,
        mask_id="m1",
        mask_record=MaskRecord(id="m1", width=4, height=4, png_b64="X", source="sam_box", label="r0"),
        mask_png_base64="X",
        paths=[[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]],
    )
    out = apply_region_masks(enriched, [fake_mask])
    # Input unchanged.
    assert enriched.model_dump() == original
    # Output has the mask applied.
    assert out.candidate_regions[0].mask_png_base64 == "X"
    assert out.candidate_regions[0].paths is not None and len(out.candidate_regions[0].paths) == 1
```

- [ ] **Step 3: Run the phases tests**

```bash
cd backend && pytest tests/tools/test_analyze_phases.py -v
```

Expected: PASS. (The no-mutation test is the load-bearing one — it pins #3 of the user's requirements.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/tools/atomic/_analyze_phases.py \
        backend/tests/tools/test_analyze_phases.py
git commit -m "refactor(analyze): extract pure phase helpers, lock no-mutation contract"
```

### Task 2.2: Implement prepare_image tool

**Files:**
- Create: `backend/app/tools/atomic/prepare_image.py`
- Create: `backend/tests/tools/test_prepare_image.py`
- Modify: `backend/app/tools/registry.py`

- [ ] **Step 1: Write the tool**

Create `backend/app/tools/atomic/prepare_image.py`:

```python
"""prepare_image MCP tool — mechanical stats + SAM embed.

Splits out the cheap, no-LLM preparatory phase that previously lived inside
analyze_image. This tool is fast (~100–300ms for the cv2 pass, +200–800ms
for the SAM encoder if ANALYZE_SAM=1) and has no LLM dependency. The
output is what every downstream phase needs.
"""

from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.state.context_stats import CheapPassResult
from app.state.document import SessionDocument
from app.tools.atomic._analyze_phases import (
    PrepareResult,
    decode_image,
    run_mechanical,
    run_sam_embed,
)
from app.tools.base import BackendTool, ToolPermissions


def _sam_enabled() -> bool:
    return os.environ.get("ANALYZE_SAM", "0") not in ("0", "", "false", "False")


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    sam_ok: bool
    image_width: int
    image_height: int
    cheap: CheapPassResult


class PrepareImageTool(BackendTool[_Input, _Output]):
    name = "prepare_image"
    kind = "mutate"
    description = (
        "Run the cheap mechanical pass (histograms, palette, cast detection) and "
        "the SAM image-encoder embed in parallel. No LLM. No mutation of "
        "candidate_regions. Idempotent: re-running on the same session re-uses "
        "cached results when present."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        sam_on = _sam_enabled()
        sam = deps.get_sam_client() if sam_on else None
        arr, w_img, h_img = decode_image(doc.image_bytes)

        if sam_on and sam is not None:
            cheap, sam_ok = await asyncio.gather(
                run_mechanical(arr), run_sam_embed(sam, doc.session_id, arr),
            )
        else:
            cheap = await run_mechanical(arr)
            sam_ok = False

        # Persist for subsequent tools that need them (region-stats, mask
        # decode). We attach via the doc, but DO NOT mutate any pydantic
        # model — these are raw outputs.
        doc.prepare_result = PrepareResult(
            cheap=cheap, sam_ok=sam_ok, image_width=w_img, image_height=h_img,
        )

        return _Output(
            sam_ok=sam_ok, image_width=w_img, image_height=h_img, cheap=cheap,
        )
```

- [ ] **Step 2: Add the `prepare_result` slot to SessionDocument**

Edit `backend/app/state/document.py`. Add:

```python
@dataclass
class SessionDocument:
    # …existing fields…
    prepare_result: "PrepareResult | None" = None
```

with `from app.tools.atomic._analyze_phases import PrepareResult` at the top (TYPE_CHECKING-guarded if needed to avoid import cycles).

- [ ] **Step 3: Register the tool**

Edit `backend/app/tools/registry.py`. Add `PrepareImageTool()` to the registration list near `AnalyzeImageTool()`.

- [ ] **Step 4: Write the tool test**

Create `backend/tests/tools/test_prepare_image.py`:

```python
"""prepare_image: ensures parallel cv2+SAM, correct shape, no mutation."""

import numpy as np
import pytest

from app.tools.atomic.prepare_image import PrepareImageTool, _Input


@pytest.mark.asyncio
async def test_prepare_image_runs_without_sam(make_doc, monkeypatch):
    monkeypatch.setenv("ANALYZE_SAM", "0")
    doc = make_doc()
    # Replace image_bytes with a real tiny JPEG for decode.
    with open("backend/tests/fixtures/test_image.jpg", "rb") as f:
        doc.image_bytes = f.read()
    out = await PrepareImageTool().handler(doc, _Input())
    assert out.sam_ok is False
    assert out.image_width > 0
    assert out.image_height > 0
    assert doc.prepare_result is not None


@pytest.mark.asyncio
async def test_prepare_image_runs_with_sam(make_doc, monkeypatch):
    """When ANALYZE_SAM=1 and a SAM client is available, sam_ok=True."""
    monkeypatch.setenv("ANALYZE_SAM", "1")

    class _Sam:
        def embed(self, _sid, _arr):
            return None

    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _Sam())
    doc = make_doc()
    with open("backend/tests/fixtures/test_image.jpg", "rb") as f:
        doc.image_bytes = f.read()
    out = await PrepareImageTool().handler(doc, _Input())
    assert out.sam_ok is True
```

- [ ] **Step 5: Run tests**

```bash
cd backend && pytest tests/tools/test_prepare_image.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tools/atomic/prepare_image.py \
        backend/app/state/document.py \
        backend/app/tools/registry.py \
        backend/tests/tools/test_prepare_image.py
git commit -m "feat(analyze): add prepare_image tool (cv2 + SAM embed)"
```

### Task 2.3: Implement analyze_context tool

**Files:**
- Create: `backend/app/tools/atomic/analyze_context.py`
- Create: `backend/tests/tools/test_analyze_context.py`
- Modify: `backend/app/tools/registry.py`

- [ ] **Step 1: Write the tool**

```python
"""analyze_context MCP tool — Claude analyze + soft fields + region_stats.

Returns the EnrichedImageContext WITHOUT mask precompute or autonomous
suggestions. This is the user-visible result: the SSE-emitted context
behind 'Objects · N', the InfoTab semantic chips, the regions list.
Splitting it out from analyze_image means precompute_regions and
suggest_widgets can run after this returns, off the user's critical path.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.image_context import ImageContext
from app.state.document import SessionDocument
from app.tools.atomic._analyze_phases import (
    PrepareResult, build_enriched, compute_region_stats, decode_image,
)
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = "legacy"


class _Output(EnrichedImageContext):
    """The EnrichedImageContext envelope. camelCase on the wire via the
    schema's alias generator from Phase 1."""


class AnalyzeContextTool(BackendTool[_Input, _Output]):
    name = "analyze_context"
    kind = "mutate"
    description = (
        "Claude analyze + soft fields + region stats. Returns the "
        "EnrichedImageContext. Does NOT pre-decode SAM masks or mint widget "
        "suggestions — those are separate tools so they don't block the "
        "user-visible analyze."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Cached short-circuit (same as analyze_image had).
        if isinstance(doc.image_context, EnrichedImageContext):
            return _Output.model_validate(doc.image_context.model_dump())

        # Prepare-step results are required (mechanical stats).
        if doc.prepare_result is None:
            # Run prepare lazily so callers can skip the explicit prepare call.
            from app.tools.atomic.prepare_image import PrepareImageTool, _Input as _PI

            await PrepareImageTool().handler(doc, _PI())
        assert doc.prepare_result is not None
        pr: PrepareResult = doc.prepare_result

        client = deps.get_anthropic_client()
        loop = asyncio.get_running_loop()

        # Decode image for region_stats. Cached on the doc if cheap to memoize.
        arr, _, _ = decode_image(doc.image_bytes)

        # Claude analyze (LLM). SAM-embed already ran in prepare; here we
        # only need the language-side work.
        doc._emit_phase_started("ai_context", index=3, total=4)
        start = time.monotonic()
        base_ctx = await loop.run_in_executor(
            None,
            lambda: client.analyze_image(
                image_bytes=doc.image_bytes,
                mime_type=doc.mime_type,
                session_id=doc.session_id,
            ),
        )
        doc._emit_phase_completed(
            "ai_context", duration_ms=int((time.monotonic() - start) * 1000),
        )
        # Stream a partial context.updated with the base shape — InfoTab
        # gets the semantic chips immediately.
        doc._emit(
            "context.updated",
            {"image_context": base_ctx.model_dump(mode="json", by_alias=True)},
        )

        # Soft fields (LLM, slower) + region_stats (cv2) run sequentially —
        # region_stats depends on the base context's regions.
        soft = await loop.run_in_executor(
            None,
            lambda: client.augment_context_soft_fields(
                image_bytes=doc.image_bytes,
                mime_type=doc.mime_type,
                base_context_json=base_ctx.model_dump(mode="json", by_alias=True),
                cheap_pass_summary={
                    "median_luma": pr.cheap.median_luma,
                    "clipped_shadows_pct": pr.cheap.clipped_shadows_pct,
                    "clipped_highlights_pct": pr.cheap.clipped_highlights_pct,
                    "contrast_p10_p90": pr.cheap.contrast_p10_p90,
                    "cast_strength": pr.cheap.cast_strength,
                    "cast_direction": list(pr.cheap.cast_direction),
                },
                session_id=doc.session_id,
            ),
        )
        region_stats = await loop.run_in_executor(
            None, compute_region_stats, arr, base_ctx, soft.region_soft_fields,
        )

        enriched = build_enriched(base_ctx, pr.cheap, soft, region_stats)
        doc.image_context = enriched
        deps.get_session_store().set_context(
            doc.session_id, enriched.model_dump(mode="json", by_alias=True),
        )
        # Final SSE for the InfoTab — picks up soft fields + region stats.
        doc._emit(
            "context.updated",
            {"image_context": {
                "estimated_white_point": list(soft.estimated_white_point),
                "wb_neutral_confidence": soft.wb_neutral_confidence,
                "grade_character": soft.grade_character,
                "problems": [p.model_dump(mode="json", by_alias=True) for p in soft.problems],
                "region_stats": [r.model_dump(mode="json", by_alias=True) for r in region_stats],
            }},
        )
        doc._emit("context.updated", {"available": True})
        return _Output.model_validate(enriched.model_dump())
```

- [ ] **Step 2: Write the tool test**

Create `backend/tests/tools/test_analyze_context.py`. Use `fake_anthropic` from the Phase 0 fixtures module so this is fast and offline:

```python
"""analyze_context: produces EnrichedImageContext, no mask precompute, no widgets."""

import pytest

from app.tools.atomic.analyze_context import AnalyzeContextTool, _Input
from tests.contract._fixtures import fake_anthropic  # noqa: F401


@pytest.mark.asyncio
async def test_analyze_context_returns_enriched(make_doc, fake_anthropic):
    doc = make_doc()
    with open("backend/tests/fixtures/test_image.jpg", "rb") as f:
        doc.image_bytes = f.read()

    out = await AnalyzeContextTool().handler(doc, _Input())
    assert out.candidate_regions is not None
    assert len(out.candidate_regions) >= 1
    # No mask precompute happened.
    for r in out.candidate_regions:
        assert r.mask_png_base64 is None
        assert r.paths is None
    # Soft fields populated.
    assert out.grade_character is not None
```

- [ ] **Step 3: Register the tool**

Edit `backend/app/tools/registry.py`. Add `AnalyzeContextTool()`.

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/tools/test_analyze_context.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/atomic/analyze_context.py \
        backend/app/tools/registry.py \
        backend/tests/tools/test_analyze_context.py
git commit -m "feat(analyze): add analyze_context tool (Claude + soft fields + stats)"
```

### Task 2.4: Implement precompute_regions tool

**Files:**
- Create: `backend/app/tools/atomic/precompute_regions.py`
- Create: `backend/tests/tools/test_precompute_regions.py`
- Modify: `backend/app/tools/registry.py`

- [ ] **Step 1: Write the tool**

```python
"""precompute_regions MCP tool — SAM box-decode for every candidate_region.

Runs after analyze_context. Pure: returns a list of decoded results, applies
them to the doc's image_context via model_copy. No model mutation in place.

NOTE: This tool becomes a fallback after Phase 4's browser MobileSAM lands.
We keep it for the no-WebGPU path and as the default before lazy load.
"""

from __future__ import annotations

import asyncio
import time

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.state.document import SessionDocument
from app.tools.atomic._analyze_phases import (
    RegionMaskResult, apply_region_masks, decode_region_mask,
)
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    mask_ids: list[str]


class PrecomputeRegionsTool(BackendTool[_Input, _Output]):
    name = "precompute_regions"
    kind = "mutate"
    description = (
        "Run SAM box-decode for every candidate_region in the current "
        "image_context. Writes mask_png_base64 + paths back onto each "
        "region (via model_copy) and registers MaskRecords in doc.masks."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if not isinstance(doc.image_context, EnrichedImageContext):
            return _Output(mask_ids=[])
        if doc.prepare_result is None or not doc.prepare_result.sam_ok:
            return _Output(mask_ids=[])

        sam = deps.get_sam_client()
        regions = doc.image_context.candidate_regions
        w_img = doc.prepare_result.image_width
        h_img = doc.prepare_result.image_height

        doc._emit_phase_started("mask_precompute", index=4, total=4)
        start = time.monotonic()
        results = await asyncio.gather(
            *(
                decode_region_mask(sam, doc.session_id, i, r, w_img, h_img)
                for i, r in enumerate(regions)
            ),
        )
        live: list[RegionMaskResult] = [r for r in results if r is not None]
        # Register MaskRecords in the doc.
        for r in live:
            doc.add_mask(r.mask_record)
        # Apply masks onto candidate_regions via model_copy — no mutation.
        new_ctx = apply_region_masks(doc.image_context, live)
        doc.image_context = new_ctx
        deps.get_session_store().set_context(
            doc.session_id, new_ctx.model_dump(mode="json", by_alias=True),
        )
        doc._emit_phase_completed(
            "mask_precompute", duration_ms=int((time.monotonic() - start) * 1000),
        )
        # Stream a context.updated so the frontend's object-mode picks up paths
        # without a refetch.
        doc._emit(
            "context.updated",
            {"image_context": {"candidate_regions": [
                r.model_dump(mode="json", by_alias=True) for r in new_ctx.candidate_regions
            ]}},
        )
        return _Output(mask_ids=[r.mask_id for r in live])
```

- [ ] **Step 2: Test it**

Create `backend/tests/tools/test_precompute_regions.py`. Use `fake_sam` to keep it offline:

```python
"""precompute_regions: SAM box-decode, applies masks via model_copy, no mutation."""

import numpy as np
import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.image_context import CandidateRegion, ImageContext
from app.tools.atomic._analyze_phases import PrepareResult
from app.state.context_stats import CheapPassResult
from app.tools.atomic.precompute_regions import PrecomputeRegionsTool, _Input


@pytest.mark.asyncio
async def test_precompute_regions_writes_paths(make_doc, monkeypatch):
    monkeypatch.setenv("ANALYZE_SAM", "1")

    class _Sam:
        def decode_box(self, _sid, pixel_bbox):
            x1, y1, x2, y2 = pixel_bbox.astype(int)
            h = max(int(y2) + 1, 4)
            w = max(int(x2) + 1, 4)
            mask = np.zeros((h, w), dtype=bool)
            mask[y1:y2, x1:x2] = True
            return mask

    monkeypatch.setattr("app.api.deps.get_sam_client", lambda: _Sam())

    doc = make_doc()
    doc.image_context = EnrichedImageContext(
        subjects=["x"], lighting="flat", dominant_tones=["midtones"], mood="m",
        candidate_regions=[
            CandidateRegion(
                label="r", description="", bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
            ),
        ],
        model_name="t", model_version="1", generated_at="2026-06-11T00:00:00Z",
        luma_histogram=[0] * 256,
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        clipped_shadows_pct=0.0, clipped_highlights_pct=0.0,
        median_luma=0.5, contrast_p10_p90=1.0, color_palette=[], cast_strength=0.0,
        cast_direction=(0.0, 0.0), region_stats=[],
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=1.0, grade_character="neutral", problems=[],
    )
    doc.prepare_result = PrepareResult(
        cheap=CheapPassResult(
            luma_histogram=[0] * 256,
            rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
            clipped_shadows_pct=0.0,
            clipped_highlights_pct=0.0,
            median_luma=0.5,
            contrast_p10_p90=1.0,
            color_palette=[],
            cast_strength=0.0,
            cast_direction=(0.0, 0.0),
        ),
        sam_ok=True, image_width=100, image_height=100,
    )

    out = await PrecomputeRegionsTool().handler(doc, _Input())
    assert len(out.mask_ids) == 1
    # Verify the model was reconstructed, not mutated: paths now present.
    assert doc.image_context.candidate_regions[0].paths is not None
    assert doc.image_context.candidate_regions[0].mask_png_base64 is not None
```

- [ ] **Step 3: Register and test**

```bash
# Register PrecomputeRegionsTool() in backend/app/tools/registry.py.
cd backend && pytest tests/tools/test_precompute_regions.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/tools/atomic/precompute_regions.py \
        backend/app/tools/registry.py \
        backend/tests/tools/test_precompute_regions.py
git commit -m "feat(analyze): add precompute_regions tool (SAM masks via model_copy)"
```

### Task 2.5: Implement suggest_widgets tool

**Files:**
- Create: `backend/app/tools/atomic/suggest_widgets.py`
- Create: `backend/tests/tools/test_suggest_widgets.py`

- [ ] **Step 1: Extract the autonomous-suggestion logic from analyze_image**

In the current `analyze_image.py`, the `_mint_autonomous_suggestions` coroutine does the Claude suggest + per-template resolve fan-out. Lift it into its own tool with no behavioral changes:

Create `backend/app/tools/atomic/suggest_widgets.py`:

```python
"""suggest_widgets MCP tool — Claude suggest_fused + N × resolve_fused.

The previous mega-tool ran this synchronously at the end of analyze_image,
blocking the user-visible return. As a standalone tool the frontend can
fire-and-forget it: the analyze_context return is what the user is
actually waiting for; widget suggestions can arrive asynchronously via SSE.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = "legacy"


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_ids: list[str]


class SuggestWidgetsTool(BackendTool[_Input, _Output]):
    name = "suggest_widgets"
    kind = "mutate"
    description = (
        "Pick fused tools that fit the current grade character, resolve each "
        "in parallel, and mint a Widget per resolved suggestion. Streams "
        "widget.created SSE events as each completes."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if not isinstance(doc.image_context, EnrichedImageContext):
            return _Output(widget_ids=[])
        # Import the existing helper so behavior is identical to today.
        from app.tools.atomic.analyze_image import _mint_autonomous_suggestions

        client = deps.get_anthropic_client()
        before = set(doc.widgets.keys())
        await _mint_autonomous_suggestions(doc, doc.image_context, client, input.layer_id)
        after = set(doc.widgets.keys())
        return _Output(widget_ids=sorted(after - before))
```

- [ ] **Step 2: Test it offline**

```python
# backend/tests/tools/test_suggest_widgets.py
import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.image_context import CandidateRegion
from app.tools.atomic.suggest_widgets import SuggestWidgetsTool, _Input
from tests.contract._fixtures import fake_anthropic  # noqa: F401


@pytest.mark.asyncio
async def test_suggest_widgets_returns_empty_when_anthropic_canned_empty(
    make_doc, fake_anthropic,
):
    """With the canned anthropic returning [] for suggest_fused, the tool
    completes without minting anything — exercises the happy path without
    real LLM cost."""
    doc = make_doc(with_image_context=True)
    out = await SuggestWidgetsTool().handler(doc, _Input())
    assert out.widget_ids == []
```

- [ ] **Step 3: Register and test**

```bash
cd backend && pytest tests/tools/test_suggest_widgets.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/tools/atomic/suggest_widgets.py \
        backend/app/tools/registry.py \
        backend/tests/tools/test_suggest_widgets.py
git commit -m "feat(analyze): add suggest_widgets tool (fire-and-forget fan-out)"
```

### Task 2.6: Update the frontend orchestrator

**Files:**
- Modify: `src/lib/backend-tools.ts` (typed surface for the 4 new tools)
- Modify: `src/hooks/useImageContext.ts` (`runAnalyse` orchestrates them)

- [ ] **Step 1: Add typed tool wrappers**

Edit `src/lib/backend-tools.ts`. Add four typed call wrappers next to the existing `analyze_image`:

```typescript
export const backendTools = {
  // …existing wrappers (analyze_image, propose_widget, …) stay until Task 2.7
  prepare_image: (sessionId: string) =>
    callTool<PrepareImageOutput>('prepare_image', sessionId, {}),
  analyze_context: (sessionId: string, input: { layerId?: string } = {}) =>
    callTool<EnrichedImageContext>('analyze_context', sessionId, input),
  precompute_regions: (sessionId: string) =>
    callTool<PrecomputeRegionsOutput>('precompute_regions', sessionId, {}),
  suggest_widgets: (sessionId: string, input: { layerId?: string } = {}) =>
    callTool<SuggestWidgetsOutput>('suggest_widgets', sessionId, input),
};
```

Type the outputs to match the pydantic camelCase shapes (e.g. `{ samOk: boolean; imageWidth: number; imageHeight: number; cheap: CheapPassResult }`).

- [ ] **Step 2: Rewrite runAnalyse to orchestrate**

Edit `src/hooks/useImageContext.ts`. Replace the body of `runAnalyse`:

```typescript
async runAnalyse() {
  const sessionId = get().sessionId;
  if (!sessionId) {
    console.warn('[ImageContext] runAnalyse: no session — call openSession first');
    return;
  }
  set({ status: 'analysing' });
  try {
    const activeLayerId =
      useEditorStore.getState().activeLayerId
      ?? useEditorStore.getState().layers.find((l) => l.type === 'image')?.id;

    // 1. Prepare (cv2 + SAM embed). Sync — needed before analyze_context.
    await backendTools.prepare_image(sessionId);
    if (get().sessionId !== sessionId) return;

    // 2. Analyze context (Claude + soft fields). User waits for THIS.
    const ctxEnv = await backendTools.analyze_context(
      sessionId, activeLayerId ? { layerId: activeLayerId } : {},
    );
    if (get().sessionId !== sessionId) return;
    if (!ctxEnv.ok || !ctxEnv.output) {
      set({
        status: 'error',
        error: ctxEnv.error?.message ?? 'analyze_context failed',
      });
      return;
    }
    const context = ctxEnv.output as ImageContext;

    if (activeLayerId) {
      await registerRegionPaths(context, activeLayerId);
    }
    set({ context, status: 'ready' });

    // 3+4. Fire-and-forget: precompute masks + autonomous suggestions.
    //     The user is interacting now; these update via SSE.
    void backendTools.precompute_regions(sessionId).catch((err) => {
      console.warn('[ImageContext] precompute_regions failed:', err);
    });
    void backendTools.suggest_widgets(
      sessionId, activeLayerId ? { layerId: activeLayerId } : {},
    ).catch((err) => {
      console.warn('[ImageContext] suggest_widgets failed:', err);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ImageContext] runAnalyse failed:', msg, err);
    set({ status: 'error', error: msg });
  }
},
```

- [ ] **Step 3: Run the frontend contract test (and update if needed)**

```bash
npx vitest run src/hooks/useImageContext.contract.test.ts
```

The test mocks `backendTools.analyze_image`. Update it to mock the new tools instead:

```typescript
vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    prepare_image: vi.fn(async () => ({ ok: true, output: { samOk: true, imageWidth: 100, imageHeight: 100 } })),
    analyze_context: vi.fn(async () => ({ ok: true, output: { /* full ImageContext shape */ } })),
    precompute_regions: vi.fn(async () => ({ ok: true, output: { maskIds: [] } })),
    suggest_widgets: vi.fn(async () => ({ ok: true, output: { widgetIds: [] } })),
  },
}));
```

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev:backend  # ensure ANALYZE_SAM=1 baked into the script
# Reload the app, open an image, run analyze.
```

Verify in devtools:
- Network: `/api/tools/prepare_image`, `/api/tools/analyze_context` (both awaited), then `/api/tools/precompute_regions`, `/api/tools/suggest_widgets` (fire-and-forget — start in parallel after analyze_context returns).
- Inspector InfoTab populates as soon as analyze_context returns — does NOT wait for the autonomous-suggestion fan-out.
- Object mode footer shows "Objects · N" once precompute_regions finishes (or once it had paths from somewhere).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backend-tools.ts \
        src/hooks/useImageContext.ts \
        src/hooks/useImageContext.contract.test.ts
git commit -m "refactor(frontend): runAnalyse orchestrates 4 tools, suggestions off-critical-path"
```

### Task 2.7: Delete `analyze_image.py`

**Files:**
- Delete: `backend/app/tools/atomic/analyze_image.py`
- Modify: `backend/app/tools/registry.py` (remove registration)
- Modify: `backend/tests/contract/test_pipeline_envelope.py` (point at new tools)
- Update or delete: any test that called `AnalyzeImageTool` directly

- [ ] **Step 1: Find every caller**

```bash
grep -rn "analyze_image\|AnalyzeImageTool" backend src --include="*.py" --include="*.ts" --include="*.tsx" | grep -v ".test."
```

Anyone still calling `backendTools.analyze_image` or the Python `AnalyzeImageTool` after Task 2.6 is dead — Task 2.6 swapped the frontend to the new tools. Remove the wrapper export from `src/lib/backend-tools.ts`.

- [ ] **Step 2: Move `_mint_autonomous_suggestions` and `_compute_region_stats`**

`suggest_widgets` and `_analyze_phases.compute_region_stats` import from `analyze_image.py`. Move these helpers into more appropriate modules:

- `_mint_autonomous_suggestions` → `backend/app/services/autonomous_suggestions.py` (or inline into `suggest_widgets.py` if no other caller; check first)
- `_compute_region_stats` → `backend/app/state/region_stats.py`

Update imports in `_analyze_phases.py` and `suggest_widgets.py`.

- [ ] **Step 3: Delete the file**

```bash
git rm backend/app/tools/atomic/analyze_image.py
```

- [ ] **Step 4: Update the contract tests**

Edit `backend/tests/contract/test_pipeline_envelope.py`. Replace POST `/api/tools/analyze_image` with sequential POSTs to the four new tools (the test now mimics the frontend orchestrator):

```python
def test_analyze_pipeline_envelope_shape(fake_anthropic, fake_sam, monkeypatch):
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)

    p = client.post("/api/tools/prepare_image", json={"session_id": sid, "input": {}}).json()
    assert p["ok"] is True

    a = client.post("/api/tools/analyze_context", json={"session_id": sid, "input": {}}).json()
    assert a["ok"] is True
    out = a["output"]
    for key in ("subjects", "lighting", "dominantTones", "mood", "candidateRegions",
                "modelName", "modelVersion", "generatedAt"):
        assert key in out

    pr = client.post("/api/tools/precompute_regions", json={"session_id": sid, "input": {}}).json()
    assert pr["ok"] is True
    # After precompute, snapshot regions carry paths + maskPngBase64.
    snap = client.get(f"/api/state/{sid}").json()
    regions = snap["image_context"]["candidateRegions"]
    assert any(r.get("paths") for r in regions)
```

- [ ] **Step 5: Run full backend test suite**

```bash
cd backend && pytest -q
```

Triage any reference to `analyze_image` left over.

- [ ] **Step 6: Run frontend check**

```bash
npm run check
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/tools/registry.py \
        backend/tests/contract/test_pipeline_envelope.py \
        backend/app/services/autonomous_suggestions.py \
        backend/app/state/region_stats.py
git rm backend/app/tools/atomic/analyze_image.py
git commit -m "refactor(analyze): delete analyze_image mega-tool; new tools fully cover it"
```

### Task 2.8: Phase 2 close — verify and clean

- [ ] **Step 1: Manual end-to-end smoke**

Open the app fresh. Load image. Run analyze. Confirm:
- InfoTab populates within ~3s.
- Object mode shows "Objects · N" within ~5s.
- Hover/click outlines + tooltip work.
- Autonomous suggestions land via SSE (no blocking).

- [ ] **Step 2: Verify no model mutation in production code paths**

```bash
grep -rn "region\.mask_png_base64 =\|region\.paths =\|ctx\.candidate_regions\[" backend/app
```

Expected: zero hits (model_copy is the only allowed write path).

- [ ] **Step 3: Tag**

```bash
git tag refactor-phase-2-done
```

---

## Phase 3: Persist sessions on disk

**Why:** Backend restart loses every session, costing the user a re-analyze (LLM + SAM dollars + wall-clock). For an MVP that's tolerable; for a thesis demo it isn't.

**Outcome:**
- Sessions persist to `backend/.sessions/<sid>/` (image.jpg + state.json + masks/)
- Restart-safe: on get(sid), load from disk if not in memory
- TTL still enforced at memory tier; disk persists until explicit eviction
- Existing `SessionStore` interface unchanged; persistence is an implementation detail

### Files

```
backend/app/services/session_store.py     (MODIFY) hybrid in-memory + disk
backend/app/services/disk_session_io.py   (NEW)    pure disk helpers
backend/tests/test_session_persistence.py (NEW)
backend/.gitignore                        (MODIFY) ignore .sessions/
```

### Task 3.1: Disk I/O helpers

**Files:**
- Create: `backend/app/services/disk_session_io.py`
- Create: `backend/tests/test_disk_session_io.py`

- [ ] **Step 1: Write the helpers**

```python
"""Pure disk I/O for SessionRecord persistence.

Layout per session:
    backend/.sessions/<sid>/
        image.<ext>     — raw uploaded bytes
        meta.json       — { mime_type, created_at }
        context.json    — full ImageContext (or absent if not yet analysed)
        masks/<id>.png  — per-mask PNG bytes (optional, mirrored from context)
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DiskRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    context_json: dict[str, Any] | None


SESSIONS_DIR = Path("backend/.sessions")


def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid


def _ext_for(mime: str) -> str:
    return {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(mime, "bin")


def save_session(sid: str, image_bytes: bytes, mime_type: str, created_at: float) -> None:
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"image.{_ext_for(mime_type)}").write_bytes(image_bytes)
    (d / "meta.json").write_text(json.dumps({"mime_type": mime_type, "created_at": created_at}))


def save_context(sid: str, context: dict[str, Any]) -> None:
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "context.json").write_text(json.dumps(context))


def load_session(sid: str) -> DiskRecord | None:
    d = _session_dir(sid)
    if not d.exists():
        return None
    meta_path = d / "meta.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    mime = meta["mime_type"]
    image_path = d / f"image.{_ext_for(mime)}"
    if not image_path.exists():
        return None
    context_path = d / "context.json"
    context = json.loads(context_path.read_text()) if context_path.exists() else None
    return DiskRecord(
        image_bytes=image_path.read_bytes(),
        mime_type=mime,
        created_at=meta.get("created_at", time.time()),
        context_json=context,
    )


def delete_session(sid: str) -> None:
    d = _session_dir(sid)
    if not d.exists():
        return
    for p in d.rglob("*"):
        if p.is_file():
            p.unlink()
    for p in sorted(d.rglob("*"), reverse=True):
        if p.is_dir():
            p.rmdir()
    d.rmdir()
```

- [ ] **Step 2: Write tests**

```python
# backend/tests/test_disk_session_io.py
import json
import time
from pathlib import Path

import pytest

from app.services.disk_session_io import (
    SESSIONS_DIR, delete_session, load_session, save_context, save_session,
)


@pytest.fixture(autouse=True)
def isolated_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    yield


def test_save_and_load_round_trip():
    save_session("sid-1", b"jpegbytes", "image/jpeg", created_at=1000.0)
    save_context("sid-1", {"hello": "world"})

    rec = load_session("sid-1")
    assert rec is not None
    assert rec.image_bytes == b"jpegbytes"
    assert rec.mime_type == "image/jpeg"
    assert rec.context_json == {"hello": "world"}


def test_load_missing_returns_none():
    assert load_session("does-not-exist") is None


def test_delete_session_removes_dir(tmp_path):
    save_session("sid-2", b"x", "image/png", created_at=0.0)
    save_context("sid-2", {"k": "v"})
    delete_session("sid-2")
    assert load_session("sid-2") is None
```

- [ ] **Step 3: Run tests**

```bash
cd backend && pytest tests/test_disk_session_io.py -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/disk_session_io.py \
        backend/tests/test_disk_session_io.py
git commit -m "feat(sessions): disk I/O helpers (image + meta + context)"
```

### Task 3.2: Hybrid SessionStore

**Files:**
- Modify: `backend/app/services/session_store.py`
- Create: `backend/tests/test_session_persistence.py`
- Modify: `backend/.gitignore`

- [ ] **Step 1: Wire disk into SessionStore.create/get/set_context**

Edit `backend/app/services/session_store.py`:

```python
# Top of file:
from app.services import disk_session_io

# In SessionStore.create:
def create(self, image_bytes: bytes, mime_type: str) -> str:
    sid = uuid.uuid4().hex
    now = time.monotonic()
    with self._lock:
        self._records[sid] = SessionRecord(
            image_bytes=image_bytes, mime_type=mime_type,
            created_at=now, last_seen=now,
        )
    disk_session_io.save_session(sid, image_bytes, mime_type, created_at=now)
    return sid

# In SessionStore.get:
def get(self, sid: str) -> SessionRecord:
    with self._lock:
        record = self._records.get(sid)
        if record is None or self._is_expired(record):
            # Try to rehydrate from disk before raising.
            disk = disk_session_io.load_session(sid)
            if disk is None:
                self._records.pop(sid, None)
                raise SessionNotFound(sid)
            now = time.monotonic()
            record = SessionRecord(
                image_bytes=disk.image_bytes,
                mime_type=disk.mime_type,
                created_at=now,
                last_seen=now,
                context=disk.context_json,
            )
            self._records[sid] = record
        record.last_seen = time.monotonic()
        return record

# In set_context:
def set_context(self, sid: str, context: dict[str, Any]) -> None:
    record = self.get(sid)
    record.context = context
    disk_session_io.save_context(sid, context)
```

- [ ] **Step 2: Restore image_context on rehydrate**

Edit `backend/app/state/document.py`. `SessionDocument.__post_init__` (or wherever it currently does first-time init) should look at the parent record's `context` field and rehydrate `image_context` if present.

Cleaner: in `get_document` of `SessionStore`:

```python
def get_document(self, sid: str) -> "SessionDocument":
    record = self.get(sid)
    if record.document is None:
        record.document = _new_document(sid, record)
        if record.context is not None:
            # Restore from disk.
            from app.schemas.enriched_context import EnrichedImageContext

            try:
                record.document.image_context = EnrichedImageContext.model_validate(record.context)
            except Exception:
                record.document.image_context = None  # corrupt cache; re-analyse
    return record.document
```

- [ ] **Step 3: Tests**

```python
# backend/tests/test_session_persistence.py
import pytest

from app.services.session_store import SessionStore


@pytest.fixture(autouse=True)
def isolated_dir(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)


def test_session_survives_store_recreation():
    """Mimics a backend restart: create session in store A, get it in store B."""
    a = SessionStore(ttl_seconds=999)
    sid = a.create(b"image-bytes", "image/jpeg")
    a.set_context(sid, {"subjects": ["x"], "candidateRegions": []})

    b = SessionStore(ttl_seconds=999)
    rec = b.get(sid)
    assert rec.image_bytes == b"image-bytes"
    assert rec.context == {"subjects": ["x"], "candidateRegions": []}


def test_missing_session_raises():
    from app.services.session_store import SessionNotFound

    s = SessionStore(ttl_seconds=999)
    with pytest.raises(SessionNotFound):
        s.get("never-existed")
```

- [ ] **Step 4: Run tests**

```bash
cd backend && pytest tests/test_session_persistence.py -v
```

Expected: PASS.

- [ ] **Step 5: Update .gitignore**

```bash
echo "backend/.sessions/" >> backend/.gitignore
```

- [ ] **Step 6: Manual smoke test**

```bash
npm run dev:backend
# Upload image + analyze. Confirm `backend/.sessions/<sid>/` contains
# image.jpg + meta.json + context.json.
# Kill the backend (Ctrl-C). Restart. Open the same session URL —
# /api/state/<sid> returns the cached context, not a 404.
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/session_store.py \
        backend/app/state/document.py \
        backend/tests/test_session_persistence.py \
        backend/.gitignore
git commit -m "feat(sessions): persist to disk, rehydrate on restart"
```

### Task 3.3: TTL semantics + eviction

- [ ] **Step 1: Decide eviction policy**

Disk persists indefinitely by default. Add an opt-in periodic prune that removes disk records whose last-seen exceeds `_ttl * 10` (10× the in-memory TTL). For the MVP, this is **manual only** — exposed as a method, not run by a background task.

Add to `SessionStore`:

```python
def prune_disk(self, max_age_seconds: float) -> int:
    """Delete on-disk session directories older than max_age_seconds.
    Returns count of pruned sessions. Caller decides when to call."""
    import time as _t
    from app.services import disk_session_io

    if not disk_session_io.SESSIONS_DIR.exists():
        return 0
    count = 0
    now = _t.time()
    for entry in disk_session_io.SESSIONS_DIR.iterdir():
        if not entry.is_dir():
            continue
        meta = entry / "meta.json"
        if not meta.exists():
            continue
        try:
            created = float(__import__("json").loads(meta.read_text()).get("created_at", 0))
        except Exception:
            continue
        if (now - created) > max_age_seconds:
            disk_session_io.delete_session(entry.name)
            count += 1
    return count
```

- [ ] **Step 2: Test**

```python
def test_prune_disk_removes_old_records(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    import time, json
    sid_old = "old-sid"
    sid_new = "new-sid"
    for sid, ts in ((sid_old, time.time() - 10_000), (sid_new, time.time())):
        d = tmp_path / sid
        d.mkdir()
        (d / "meta.json").write_text(json.dumps({"mime_type": "image/jpeg", "created_at": ts}))
        (d / "image.jpg").write_bytes(b"x")
    from app.services.session_store import SessionStore
    pruned = SessionStore(ttl_seconds=1).prune_disk(max_age_seconds=3600)
    assert pruned == 1
    assert not (tmp_path / sid_old).exists()
    assert (tmp_path / sid_new).exists()
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/session_store.py \
        backend/tests/test_session_persistence.py
git commit -m "feat(sessions): add prune_disk for opt-in disk eviction"
git tag refactor-phase-3-done
```

---

## Phase 4: Browser MobileSAM

**Why:** Backend box-prompted SAM 2 produces masks that look rough; refinement via SSE is too slow to feel interactive (>150ms round-trip). The design doc (`docs/superpowers/specs/2026-06-10-object-mode-segment-extraction-design.md`) prescribes ONNX MobileSAM in the browser via WebGPU, ~20ms per click. The plan in `docs/superpowers/plans/2026-06-10-object-mode-segment-extraction.md` already covers this at high TDD granularity — we incorporate by reference and add only what's specific to bringing it forward.

**Outcome:**
- `MobileSAM` encoder lazy-loads once per session (~10MB ONNX)
- One-time encoder pass per imageNodeId (~300-800ms, cached)
- Per-click decoder (~20ms) for shift/cmd-click refinement
- `propose_mask` MCP tool commits client-side masks server-side
- `precompute_regions` becomes a fallback (no WebGPU → still works)
- `useSegmentInteraction` + `segmentStore` retired; SegmentHitLayer reads from MobileSAM state

### Approach

The existing `2026-06-10-object-mode-segment-extraction.md` plan documents this work in detail (~3000 lines). Re-use those tasks verbatim — they're already TDD-shaped — with the following changes specific to this refactor:

### Task 4.1: Decoupling from segmentStore

The existing plan assumed `segmentStore` survives. After Phase 1, we already bypassed `segmentStore` for the regions list. Phase 4 deletes `segmentStore` and `useSegmentInteraction` entirely; replace with:

- Per-imageNodeId encoder/embedding cache lives in `src/lib/segmentation/mobile-sam-client.ts`
- `useMobileSam(imageNodeId)` returns `{ ready, decode_for_click }`
- `SegmentHitLayer` calls `decode_for_click(nx, ny, mode)` on shift/cmd-click

Concrete steps:

- [ ] **Step 1: Implement mobile-sam-client.ts and useMobileSam.ts following the existing plan's tasks 1–12**

Refer to `docs/superpowers/plans/2026-06-10-object-mode-segment-extraction.md`. The ONNX session, encoder/decoder loading, embedding cache pattern, and click prompt encoding are all specified there. Copy verbatim, adjusting only the imports because Phase 1 changed types and Phase 2 changed the backend tool surface.

- [ ] **Step 2: Add `propose_mask` MCP tool**

The existing plan specifies the tool. The change here is to use Phase 1's `camel_config` for the schema:

```python
# backend/app/tools/atomic/propose_mask.py
from pydantic import BaseModel

from app.schemas._camel import camel_config


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    image_node_id: str
    png_base64: str
    paths: list[list[list[float]]]
    label: str | None = None
    origin: str  # "client_refinement" | "client_new"


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    mask_id: str
```

Handler: register the mask via `doc.add_mask(MaskRecord(...))`, return the new mask_id.

- [ ] **Step 3: Wire SegmentHitLayer to MobileSAM**

`SegmentHitLayer` now:
- Hover: hit-test against `useAiSession.context.candidateRegions` AND any client-proposed masks accumulated in this session (already in `doc.masks_index`, surfaced via snapshot).
- Click: select the hit region (today's behavior).
- Shift+click: call `decode_for_click(nx, ny, 'positive')` from `useMobileSam(imageNodeId)`. The new mask appears as a cyan candidate. Enter commits via `propose_mask`. Esc discards.
- Cmd+click on a selected mask: same as shift but adds a refinement point to the active mask.

- [ ] **Step 4: Delete segmentStore + useSegmentInteraction**

```bash
git rm src/lib/segmentation/segment-store.ts
git rm src/hooks/useSegmentInteraction.ts
```

Update tests:

```bash
git rm src/lib/segmentation/segment-store.test.ts
git rm src/hooks/useSegmentInteraction.test.tsx
```

Remove the `useSegmentInteraction(id)` call from `ImageNode.tsx`. Search for any other importers and replace with `useMobileSam(imageNodeId)`.

- [ ] **Step 5: Demote precompute_regions to fallback**

After MobileSAM lands, `precompute_regions` is only needed when WebGPU is unavailable. Gate the call in `runAnalyse`:

```typescript
const hasWebGPU = 'gpu' in navigator;
if (!hasWebGPU) {
  void backendTools.precompute_regions(sessionId);
}
```

If you'd rather drop it entirely (no-WebGPU users see no outlines), `git rm backend/app/tools/atomic/precompute_regions.py` and delete its registration.

- [ ] **Step 6: Commit**

```bash
git add ...
git rm src/lib/segmentation/segment-store.ts \
       src/hooks/useSegmentInteraction.ts \
       src/lib/segmentation/segment-store.test.ts \
       src/hooks/useSegmentInteraction.test.tsx
git commit -m "feat(segmentation): browser MobileSAM, retire segmentStore + useSegmentInteraction"
git tag refactor-phase-4-done
```

### Task 4.2: Verification matrix

After Phase 4 lands, verify end-to-end:

- [ ] **Step 1: Hover/click on AI-named regions still works (Phase 2 paths)**
- [ ] **Step 2: Shift-click on a new spot produces a refined mask within ~50ms**
- [ ] **Step 3: Refinement clicks update the mask live**
- [ ] **Step 4: Enter commits via propose_mask; the new mask appears in `useBackendState.snapshot.masks_index`**
- [ ] **Step 5: Esc discards the candidate**
- [ ] **Step 6: No-WebGPU fallback (test in Firefox Stable as of writing): existing AI regions hover/click works; refinement disabled gracefully with a toast**

---

## Cross-phase cleanup checklist

A running list of legacy code each phase deletes. Strike-through as it goes.

- [ ] `src/types/enriched-context.ts` (Phase 1)
- [ ] `src/hooks/useImageContextFull.ts` (Phase 1)
- [ ] Snake-case field reads in InfoTab/RegionsSection/SemanticSection (Phase 1)
- [ ] Zod conversion in `ImageContextSchema.parse` (Phase 1; demoted to pass-through validator or deleted)
- [ ] `backend/app/tools/atomic/analyze_image.py` (Phase 2)
- [ ] In-place mutation of `region.mask_png_base64` / `region.paths` in backend (Phase 2)
- [ ] In-place mutation of `region.maskRef` in frontend `registerRegionPaths` (Phase 4 — replace with a separate `maskRegistrations` map keyed by region id)
- [ ] `src/lib/segmentation/segment-store.ts` (Phase 4)
- [ ] `src/hooks/useSegmentInteraction.ts` (Phase 4)
- [ ] `backend/app/tools/atomic/precompute_regions.py` (Phase 4 — optional, demote or delete)

---

## Acceptance criteria per phase

**Phase 0:** Two new contract tests pass against current code.

**Phase 1:**
- `grep -rn 'candidate_regions\|representative_point\|mask_png_base64\|dominant_tones' src --include='*.ts' --include='*.tsx' | grep -v '.test.'` returns no hits in production code.
- Backend `/api/state/{sid}` returns camelCase keys at every level.
- Frontend `useAiSession.context` and `useBackendState.snapshot.image_context` are the same type (`ImageContext`).
- `src/types/enriched-context.ts` and `src/hooks/useImageContextFull.ts` are deleted.
- All existing tests pass.

**Phase 2:**
- `backend/app/tools/atomic/analyze_image.py` is deleted.
- 4 new tools registered, each with a passing unit test.
- Frontend `runAnalyse` calls 4 tools in the documented order; suggestions are fire-and-forget.
- `grep -rn 'region\.mask_png_base64 =\|region\.paths =' backend/app` returns zero hits.
- End-to-end smoke: InfoTab populates within 3s; objects mode within 5s.

**Phase 3:**
- Killing + restarting the backend preserves the session — frontend stays usable without re-analyze.
- `backend/.sessions/` is in `.gitignore`.
- `prune_disk` test passes.

**Phase 4:**
- Shift-click on a new spot produces a refined mask within 50ms (after one-time encoder warm-up).
- `segmentStore.ts` and `useSegmentInteraction.ts` are deleted.
- `propose_mask` MCP tool registered, masks land in snapshot.masks_index.
- Verification matrix in Task 4.2 all green.

---

## Anticipated risks and mitigations

| Risk | Mitigation |
|---|---|
| Phase 1 misses a snake_case field, runtime breaks silently | Contract tests on both backend and frontend assert key presence; `tsc --noEmit` after every change |
| Phase 2 changes SSE event ordering and breaks the InfoTab loading sequence | The four new tools preserve the same SSE event names + order; tests assert on event sequence in `test_pipeline_envelope.py` |
| Phase 3 disk corruption silently rehydrates a bad context | `EnrichedImageContext.model_validate` raises on corrupt JSON; the `get_document` rehydrate sets `image_context = None` on failure so the user can re-analyze |
| Phase 4 WebGPU not available (Firefox Stable) | `useMobileSam` exposes `ready` flag; `precompute_regions` tool kept as a fallback for the no-WebGPU path |
| Bundle size jumps with ONNX assets | Dynamic `import()` behind first object-mode entry; lazy-load measured in Phase 4 |

---

## Execution notes

- Each phase produces shippable, testable software. Stop and merge between phases.
- All new tests are fast (no network, no GPU): backend uses monkey-patched fakes; frontend uses `vi.mock`.
- Use Phase 0's contract tests as the rope to pull every later phase through: they should be the LAST thing you break and the FIRST thing you fix.
- Keep the commit boundary at task granularity. Force-pushing is not allowed; if you blow a commit, follow-up commit fixes it.
- After each phase: tag `refactor-phase-N-done` so the next phase can `git rebase --onto`.
