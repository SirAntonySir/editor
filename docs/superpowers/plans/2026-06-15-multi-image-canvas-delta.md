# Multi-Image Canvas — Delta Plan vs. 2026-05-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the partially-shipped 2026-05-30 canvas-workspace plan from "single auto-spawned ImageNode per session" to "N ImageNodes per session, each with its own pixels, AI context, masks, and widgets."

**Architecture:** The frontend already has the multi-image *data model* (ImageNodeState carries N layerIds, `addImageNode` / `splitImageNode` / `mergeImageNodes` are live on `workspace-slice`, and the `Scope` union already includes `{ kind: 'image_node', imageNodeId, layerIds }`). What does NOT exist yet: (a) a way to add a second image without resetting the session, and (b) backend per-node addressing for `image_bytes`, `image_context`, `prepare_result`, and `MaskRecord`. This plan closes both.

**Tech Stack:** React 19 + Zustand v5 + Immer (frontend), FastAPI + Pydantic v2 (backend), React Flow workspace surface, existing WebGL pipeline.

---

## Status of the 2026-05-30 plan (what to skip)

These tasks from `docs/superpowers/plans/2026-05-30-canvas-workspace.md` are **already implemented** and should NOT be re-executed:

| Original task | Status | Evidence |
|---|---|---|
| Task 1 — `workspace-slice` with `addImageNode` / `setNodePosition` | DONE | `src/store/workspace-slice.ts:181` |
| Task 2 — `splitImageNode` / `mergeImageNodes` / `removeImageNode` | DONE | `src/store/workspace-slice.ts:208,238,253` |
| Task 4 — React Flow surface, ImageNode + WidgetNode custom types | DONE | `src/components/workspace/` (ImageNode, ImageNodeBody, TetherEdge) |
| Task 8 — `ImageNodeState` types (id / layerIds / position / size / sourceSize) | DONE | `src/types/workspace.ts` |
| Task 17 — Backend `ImageNodeScope` variant in `Scope` union | DONE | `backend/app/schemas/widget.py:33` |
| Task 18 — `image_node_transforms` keyed by image-node id (crop/rotate per node) | DONE | `backend/app/state/document.py:51`, plan `2026-06-02-image-node-crop-rotate.md` |
| Task 19 — `set_image_node_transform` tool | DONE | `backend/app/tools/atomic/set_image_node_transform.py` |

These tasks are **superseded** by later plans:

| Original task | Superseded by |
|---|---|
| Task 3 — "layer panel disappears, layers become a stack strip inside the ImageNode" | Deferred. Today the panel scopes to `activeImageNodeId` via `useLayerWidgets`. Keeping it for v1; revisit after this delta lands. |
| Task 20 — "workspace positions persisted in `.edp`" | Out of scope. `.edp` work tracked separately (see `project_graph_architecture` memory). |

---

## What's left — task overview

1. Backend: turn `image_bytes` from a singleton into a per-ImageNode dict
2. Backend: turn `image_context` and `prepare_result` into per-ImageNode dicts
3. Backend: add `image_node_id` to `MaskRecord` so masks target a node
4. Backend: `POST /sessions/:sid/images` — add an image to an existing session
5. Frontend: `editorDocument.addImage(file)` — append-not-replace
6. Frontend: MenuBar "Add image…" entry + Cmd+Shift+O shortcut
7. Frontend: ImageNode header — Split-selected-layer and Merge-into-active controls
8. Frontend: Toolrail / Cmd+K scope plumbing — emit `image_node` scope on the active node
9. Frontend: Layers panel — scope to `activeImageNodeId`'s layer set (not all layers)
10. Verification: end-to-end smoke test (open A, add B, adjust A, adjust B, split, merge)

---

## Task 1: Backend — per-ImageNode `image_bytes`

**Why:** Today `SessionDocument.image_bytes: bytes` is a singleton, so a second ImageNode cannot have its own pixels. The analyse / segment endpoints read it directly (`backend/app/api/analyze.py:387`, `backend/app/api/segment.py:77`).

**Files:**
- Modify: `backend/app/state/document.py:40-46`
- Modify: `backend/app/session/revive.py:86-94`
- Modify: `backend/app/session/persistence.py:37`
- Test: `backend/tests/test_document_image_bytes_per_node.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_document_image_bytes_per_node.py
from app.state.document import SessionDocument

def test_image_bytes_keyed_by_image_node_id():
    doc = SessionDocument(session_id="s1")
    doc.set_image_bytes("in-1", b"AAAA", mime_type="image/png")
    doc.set_image_bytes("in-2", b"BBBB", mime_type="image/jpeg")

    assert doc.get_image_bytes("in-1") == b"AAAA"
    assert doc.get_image_bytes("in-2") == b"BBBB"
    assert doc.get_mime_type("in-1") == "image/png"
    assert doc.get_mime_type("in-2") == "image/jpeg"

def test_get_image_bytes_unknown_node_returns_empty():
    doc = SessionDocument(session_id="s1")
    assert doc.get_image_bytes("in-missing") == b""
```

- [ ] **Step 2: Run test, verify it fails**

```
pytest backend/tests/test_document_image_bytes_per_node.py -v
```
Expected: FAIL — `SessionDocument` has no `set_image_bytes` / `get_image_bytes`.

- [ ] **Step 3: Implement per-node storage**

Replace the singleton fields in `SessionDocument` (around `document.py:40-46`):

```python
# REMOVE these two fields:
# image_bytes: bytes = b""
# mime_type: str = "image/jpeg"

# ADD:
image_bytes_by_node: dict[str, bytes] = Field(default_factory=dict)
mime_type_by_node: dict[str, str] = Field(default_factory=dict)
```

Add methods (anywhere in the class body, group near `set_image_node_transform`):

```python
def set_image_bytes(self, image_node_id: str, data: bytes, *, mime_type: str) -> None:
    self.image_bytes_by_node[image_node_id] = data
    self.mime_type_by_node[image_node_id] = mime_type

def get_image_bytes(self, image_node_id: str) -> bytes:
    return self.image_bytes_by_node.get(image_node_id, b"")

def get_mime_type(self, image_node_id: str) -> str:
    return self.mime_type_by_node.get(image_node_id, "image/jpeg")
```

- [ ] **Step 4: Update every reader to require an image_node_id**

Grep for `.image_bytes` / `record.image_bytes` / `doc.image_bytes` across `backend/app/`:

```bash
grep -rn "\.image_bytes\b\|\.mime_type\b" backend/app/ --include="*.py"
```

Each call site must now pass the target node id. The session-upload path (Task 4) will mint a default id `"in-default"` for the first image so existing code paths that have no node id in hand can resolve one. Update:

- `backend/app/api/session.py:25` — pass `image_node_id="in-default"` when creating
- `backend/app/api/analyze.py:387,395,490` — accept an `image_node_id` arg (default `"in-default"`)
- `backend/app/api/segment.py:77` — same
- `backend/app/session/revive.py:86-94` — restore `image_bytes_by_node` from disk index
- `backend/app/session/persistence.py:37` — replace `"image_bytes"` exclusion with `"image_bytes_by_node"`

- [ ] **Step 5: Adjust the existing session-bootstrap test**

```bash
grep -rln "image_bytes=" backend/tests/ --include="*.py"
```

Migrate each `image_bytes=b"…"` constructor call to `set_image_bytes("in-default", …, mime_type=…)` after construction.

- [ ] **Step 6: Run full backend test suite**

```
cd backend && pytest -q
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/state/document.py backend/app/api/session.py backend/app/api/analyze.py backend/app/api/segment.py backend/app/session/revive.py backend/app/session/persistence.py backend/tests/
git commit -m "refactor(backend): key image_bytes by image_node_id"
```

---

## Task 2: Backend — per-ImageNode `image_context` and `prepare_result`

**Why:** AI image-context is pre-computed once per image and cached; with N images, each needs its own cached context (see `project_ai_image_context` memory).

**Files:**
- Modify: `backend/app/state/document.py:42,46`
- Modify: `backend/app/tools/atomic/analyze_context.py`
- Modify: `backend/app/tools/atomic/get_image_context.py`
- Modify: `backend/app/state/snapshot.py:17,27`
- Test: `backend/tests/test_image_context_per_node.py` (create)

- [ ] **Step 1: Failing test**

```python
# backend/tests/test_image_context_per_node.py
from app.state.document import SessionDocument
from app.schemas.image_context import EnrichedImageContext

def _ctx(label: str) -> EnrichedImageContext:
    # Minimal valid context — adjust the constructor to whatever
    # EnrichedImageContext requires (see schemas/image_context.py).
    return EnrichedImageContext.model_validate({"summary": label})

def test_image_context_keyed_by_image_node():
    doc = SessionDocument(session_id="s1")
    doc.set_image_context("in-1", _ctx("A"))
    doc.set_image_context("in-2", _ctx("B"))
    assert doc.get_image_context("in-1").summary == "A"
    assert doc.get_image_context("in-2").summary == "B"
    assert doc.get_image_context("in-missing") is None
```

- [ ] **Step 2: Run, verify FAIL**

```
pytest backend/tests/test_image_context_per_node.py -v
```

- [ ] **Step 3: Implement**

In `document.py`, replace singletons:

```python
# REMOVE:
# image_context: ImageContext | None = None
# prepare_result: Any = None

# ADD:
image_context_by_node: dict[str, ImageContext] = Field(default_factory=dict)
prepare_result_by_node: dict[str, Any] = Field(default_factory=dict)
```

Add methods:

```python
def set_image_context(self, image_node_id: str, ctx: ImageContext) -> None:
    self.image_context_by_node[image_node_id] = ctx

def get_image_context(self, image_node_id: str) -> ImageContext | None:
    return self.image_context_by_node.get(image_node_id)

def set_prepare_result(self, image_node_id: str, result: Any) -> None:
    self.prepare_result_by_node[image_node_id] = result

def get_prepare_result(self, image_node_id: str) -> Any:
    return self.prepare_result_by_node.get(image_node_id)
```

- [ ] **Step 4: Update analyze + get tools**

In `analyze_context.py` and `get_image_context.py`, change the signature to accept `image_node_id: str` (default `"in-default"`), then route through `doc.set_image_context(image_node_id, …)` / `doc.get_image_context(image_node_id)`. The tool schemas must add an optional `image_node_id` field.

- [ ] **Step 5: Update snapshot summary**

`backend/app/state/snapshot.py:17,27` currently exposes `image_context: EnrichedImageContext | None`. Change to:

```python
image_context_by_node: dict[str, EnrichedImageContext] = Field(default_factory=dict)
```

And in `Snapshot.from_doc`, replace the one-context check with a dict comprehension that includes only EnrichedImageContext entries.

- [ ] **Step 6: Frontend type update**

In `src/types/backend.ts` (or wherever `SessionStateSnapshot` is mirrored), rename `image_context` → `image_context_by_node: Record<string, EnrichedImageContext>`. Then update every reader:

```bash
grep -rn "snapshot\.image_context\b\|snapshot\.imageContext\b" src/ --include="*.ts" --include="*.tsx"
```

Each call site now needs an image-node id. For the Info tab and tooltip surfaces, default to `useEditorStore.getState().activeImageNodeId ?? 'in-default'`.

- [ ] **Step 7: Run tests, lint, typecheck**

```
cd backend && pytest -q && cd .. && npm run check
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/state/ backend/app/tools/atomic/analyze_context.py backend/app/tools/atomic/get_image_context.py backend/app/schemas/ backend/tests/ src/
git commit -m "refactor(backend+fe): key image_context and prepare_result by image_node_id"
```

---

## Task 3: Backend — `MaskRecord.image_node_id`

**Why:** Masks today live in `doc.masks: dict[str, MaskRecord]` keyed only by mask id. With N images, a "person" mask on image A must not be picked up by widgets bound to image B.

**Files:**
- Modify: `backend/app/schemas/widget.py` (MaskRecord)
- Modify: `backend/app/state/document.py` (mask creation paths)
- Modify: `backend/app/api/segment.py` (mask creation)
- Test: `backend/tests/test_mask_record_image_node.py` (create)

- [ ] **Step 1: Failing test**

```python
# backend/tests/test_mask_record_image_node.py
from app.schemas.widget import MaskRecord

def test_mask_record_requires_image_node_id():
    rec = MaskRecord(id="m1", image_node_id="in-1", width=10, height=10,
                     source="segmenter", label="person")
    assert rec.image_node_id == "in-1"

def test_mask_record_image_node_id_is_required():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        MaskRecord(id="m1", width=10, height=10, source="segmenter", label="person")
```

- [ ] **Step 2: Verify FAIL**

```
pytest backend/tests/test_mask_record_image_node.py -v
```

- [ ] **Step 3: Add field**

In `widget.py`, locate `class MaskRecord(BaseModel)` and add:

```python
image_node_id: str = Field(min_length=1)
```

- [ ] **Step 4: Update every MaskRecord constructor**

```bash
grep -rn "MaskRecord(" backend/app/ --include="*.py"
```

At each call site, pass `image_node_id` from the surrounding context. `segment.py` already has access to the source image node id via the segment request payload — extend the request schema to require it.

- [ ] **Step 5: Update mask_index in snapshot**

`apply_snapshot` (`document.py:104`) emits `masksIndex` entries. Add `"imageNodeId": m.image_node_id` to each dict.

- [ ] **Step 6: Frontend — filter masks by active node in the inspector**

In `src/components/inspector/MaskPicker.tsx` (or wherever masks are listed), filter the masks list by `activeImageNodeId`:

```ts
const masks = useBackendState(s => s.snapshot?.masksIndex ?? []);
const activeId = useEditorStore(s => s.activeImageNodeId);
const visible = masks.filter(m => m.imageNodeId === activeId);
```

- [ ] **Step 7: Backend + frontend tests, lint, typecheck**

```
cd backend && pytest -q && cd .. && npm run check
```

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/widget.py backend/app/state/document.py backend/app/api/segment.py backend/tests/ src/components/inspector/MaskPicker.tsx
git commit -m "feat(backend): MaskRecord carries image_node_id; FE inspector filters by active node"
```

---

## Task 4: Backend — `POST /sessions/:sid/images` endpoint

**Why:** The frontend needs a way to upload a second image into an existing session without creating a new one or wiping state.

**Files:**
- Modify: `backend/app/api/session.py`
- Test: `backend/tests/test_add_image_to_session.py` (create)

- [ ] **Step 1: Failing test**

```python
# backend/tests/test_add_image_to_session.py
from fastapi.testclient import TestClient
from app.main import app

def test_add_image_to_session_creates_node_and_returns_id():
    c = TestClient(app)
    create = c.post("/sessions", files={"image": ("a.jpg", b"AAAA", "image/jpeg")})
    sid = create.json()["session_id"]

    add = c.post(f"/sessions/{sid}/images",
                 files={"image": ("b.png", b"BBBB", "image/png")})
    assert add.status_code == 200
    new_id = add.json()["image_node_id"]
    assert new_id != "in-default"
    assert new_id.startswith("in-")
```

- [ ] **Step 2: Verify FAIL**

```
pytest backend/tests/test_add_image_to_session.py -v
```

- [ ] **Step 3: Implement endpoint**

Add to `session.py`:

```python
@router.post("/sessions/{sid}/images")
async def add_image(sid: str, image: UploadFile) -> dict[str, str]:
    rec = store.get(sid)
    if rec is None:
        raise HTTPException(404, "session not found")
    data = await image.read()
    if len(data) > settings.max_image_bytes:
        raise HTTPException(413, "image too large")
    # Mint a new node id. Use the same counter style as the frontend
    # (`in-<n>`) so the two sides agree on the namespace.
    existing = list(rec.image_bytes_by_node.keys())
    next_n = 1 + max((int(k.split("-")[1]) for k in existing if k.startswith("in-") and k.split("-")[1].isdigit()), default=0)
    image_node_id = f"in-{next_n}"
    rec.set_image_bytes(image_node_id, data, mime_type=image.content_type or "image/jpeg")
    # Persist alongside the original on disk via disk_session_io
    disk_session_io.write_image(sid, image_node_id, data, image.content_type)
    return {"image_node_id": image_node_id}
```

- [ ] **Step 4: Run test, expect PASS**

```
pytest backend/tests/test_add_image_to_session.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/session.py backend/tests/test_add_image_to_session.py
git commit -m "feat(backend): POST /sessions/:sid/images — add image without resetting session"
```

---

## Task 5: Frontend — `editorDocument.addImage(file)`

**Why:** Counterpart to `openImage` that appends instead of resetting.

**Files:**
- Modify: `src/core/document.ts` (add `addImage` near `openImage`, re-export from `editorDocument`)
- Modify: `src/hooks/useImageContext.ts` (`openSession` companion: `addImageToSession`)
- Test: `src/core/__tests__/addImage.test.ts` (create)

- [ ] **Step 1: Failing test**

```ts
// src/core/__tests__/addImage.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { editorDocument } from '@/core/document';
import { useEditorStore } from '@/store';

describe('editorDocument.addImage', () => {
  beforeEach(() => editorDocument.closeDocument());

  it('appends a new ImageNode + layer without clearing existing ones', async () => {
    const fileA = new File([new Uint8Array([1,2,3])], 'a.png', { type: 'image/png' });
    const fileB = new File([new Uint8Array([4,5,6])], 'b.png', { type: 'image/png' });

    await editorDocument.openImage(fileA);
    const layersBefore = useEditorStore.getState().layers.length;
    const nodesBefore = Object.keys(useEditorStore.getState().imageNodes).length;

    await editorDocument.addImage(fileB);
    const state = useEditorStore.getState();

    expect(state.layers.length).toBe(layersBefore + 1);
    expect(Object.keys(state.imageNodes).length).toBe(nodesBefore + 1);
  });
});
```

- [ ] **Step 2: Verify FAIL**

```
npm run test -- src/core/__tests__/addImage.test.ts
```

- [ ] **Step 3: Implement `addImage`**

In `src/core/document.ts`, hoist a helper near `openImage`:

```ts
async function addImage(file: File): Promise<void> {
  const bitmap = await createImageBitmap(file);
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (ctx) ctx.drawImage(bitmap, 0, 0);

  const layerId = crypto.randomUUID();
  pixelStore.register(layerId, offscreen);

  const sid = useBackendState.getState().sessionId;
  if (sid) void putSource(sid, layerId, file);

  const store = useEditorStore;
  // Place the new image node to the right of existing ones to avoid overlap.
  const existing = Object.values(store.getState().imageNodes);
  const maxRight = existing.reduce((m, n) => Math.max(m, n.position.x + n.size.w), 0);
  const newImageNodeId = store.getState().addImageNode(
    [layerId],
    { x: maxRight + 80, y: 0 },
    { w: bitmap.width, h: bitmap.height },
  );

  store.setState((s) => ({
    layers: [
      ...s.layers,
      {
        id: layerId,
        type: 'image',
        name: file.name,
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        locked: false,
        order: s.layers.length,
      },
    ],
    activeLayerId: layerId,
  }));

  // Upload to backend keyed by the new image_node_id.
  void import('@/hooks/useImageContext').then(({ useAiSession }) =>
    useAiSession.getState().addImageToSession(offscreen, newImageNodeId),
  );

  history.push(captureState()!);
  markDirty();
  bitmap.close();
}
```

Add to the `editorDocument` export object:

```ts
addImage,
```

- [ ] **Step 4: Implement `useAiSession.addImageToSession`**

In `src/hooks/useImageContext.ts`, alongside `openSession`, add an action that POSTs to `/sessions/:sid/images` (created in Task 4) and returns the new node id. Skeleton:

```ts
addImageToSession: async (canvas: OffscreenCanvas, imageNodeId: string) => {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return;
  const blob = await downscaleForUpload(canvas);
  const fd = new FormData();
  fd.append('image', blob, `${imageNodeId}.png`);
  const res = await fetch(`${BACKEND_URL}/sessions/${sid}/images`, { method: 'POST', body: fd });
  if (!res.ok) { /* log + noop */ return; }
  // Backend echoes the node id; if it differs (race on id minting), warn but
  // trust the backend's id — the frontend's `addImageNode` will still work
  // because all routing is by id, and the FE id is local to the store.
},
```

- [ ] **Step 5: Run tests, lint, typecheck**

```
npm run test -- src/core/__tests__/addImage.test.ts && npm run check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/document.ts src/hooks/useImageContext.ts src/core/__tests__/addImage.test.ts
git commit -m "feat(frontend): editorDocument.addImage — append second image without reset"
```

---

## Task 6: Frontend — MenuBar "Add image…" + Cmd+Shift+O

**Files:**
- Modify: `src/components/toolbar/MenuBar.tsx` (find the "Open…" entry)
- Modify: `src/components/KeyboardShortcuts.tsx` (or wherever shortcuts register)
- Modify: `src/lib/open-file.ts` — add `addImageFromPicker`
- Test: `src/lib/__tests__/open-file.test.ts` (extend)

- [ ] **Step 1: Add `addImageFromPicker` helper**

```ts
// src/lib/open-file.ts
export function addImageFromPicker(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    await editorDocument.addImage(file);
  };
  input.click();
}
```

- [ ] **Step 2: Wire MenuBar entry**

In `MenuBar.tsx`, under the File menu, add an entry below "Open…":

```tsx
<DropdownMenuItem
  onSelect={addImageFromPicker}
  disabled={!useEditorStore.getState().documentMeta || sseStatus !== 'open'}
>
  Add image…
  <DropdownMenuShortcut>⌘⇧O</DropdownMenuShortcut>
</DropdownMenuItem>
```

(Disabled when no document is open OR backend disconnected — matches existing toolrail gating.)

- [ ] **Step 3: Wire shortcut**

In `KeyboardShortcuts.tsx`, register `cmd+shift+o` → `addImageFromPicker`.

- [ ] **Step 4: Smoke-test manually**

Open one image, hit Cmd+Shift+O, pick another. Both should be visible on the React Flow canvas, side by side.

- [ ] **Step 5: Lint, typecheck**

```
npm run check
```

- [ ] **Step 6: Commit**

```bash
git add src/components/toolbar/MenuBar.tsx src/components/KeyboardShortcuts.tsx src/lib/open-file.ts
git commit -m "feat(frontend): File → Add image… (⌘⇧O) appends a second image"
```

---

## Task 7: Frontend — ImageNode header Split / Merge controls

**Why:** `splitImageNode` and `mergeImageNodes` are already in the store but have no UI affordance.

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Test: `src/components/workspace/__tests__/ImageNode.test.tsx` (extend)

- [ ] **Step 1: Failing test for "Split active layer" affordance**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { useEditorStore } from '@/store';
import { ImageNode } from '../ImageNode';

test('clicking Split peels the active layer onto a new ImageNode', () => {
  useEditorStore.setState({
    imageNodes: { 'in-1': { id: 'in-1', layerIds: ['l1', 'l2'], position: {x:0,y:0}, size:{w:200,h:200}, sourceSize:{w:200,h:200} } },
    activeImageNodeId: 'in-1',
    activeLayerId: 'l2',
    layers: [
      { id: 'l1', type:'image', name:'A', visible:true, opacity:1, blendMode:'normal', locked:false, order:0 },
      { id: 'l2', type:'image', name:'B', visible:true, opacity:1, blendMode:'normal', locked:false, order:1 },
    ],
  });
  render(<ImageNode id="in-1" data={{}} />);
  fireEvent.click(screen.getByLabelText('Split active layer to new image node'));

  const nodes = Object.keys(useEditorStore.getState().imageNodes);
  expect(nodes.length).toBe(2);
});
```

- [ ] **Step 2: Verify FAIL**

```
npm run test -- src/components/workspace/__tests__/ImageNode.test.tsx
```

- [ ] **Step 3: Add affordances**

In `ImageNode.tsx`, in the header overlay (visible on selection), add:

```tsx
{layerIds.length > 1 && (
  <IconButton
    aria-label="Split active layer to new image node"
    onClick={() => editorDocument.workspace.splitActiveLayer(id)}
  >
    <SplitIcon />
  </IconButton>
)}
{otherImageNodesExist && (
  <IconButton
    aria-label="Merge this image into the previously active one"
    onClick={() => editorDocument.workspace.mergeInto(previousActiveId, id)}
  >
    <MergeIcon />
  </IconButton>
)}
```

(`workspace.splitActiveLayer` / `workspace.mergeInto` are thin facade methods on `editorDocument.workspace` that call the store actions and push a history entry.)

- [ ] **Step 4: Run test, expect PASS, run lint+typecheck**

```
npm run test -- src/components/workspace/__tests__/ImageNode.test.tsx && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/core/document.ts src/components/workspace/__tests__/ImageNode.test.tsx
git commit -m "feat(workspace): ImageNode header — split active layer / merge into prior node"
```

---

## Task 8: Frontend — Scope plumbing for toolrail and Cmd+K

**Why:** Toolrail click and Cmd+K must emit `{ kind: 'image_node', imageNodeId, layerIds }` so the resulting widget tethers to the correct image. Today the call site likely defaults to `GLOBAL_SCOPE`.

**Files:**
- Modify: `src/lib/toolrail-spawn.ts`
- Modify: `src/components/EditorDialog.tsx` (or wherever the palette `propose_widget` call lives)
- Test: extend `src/lib/__tests__/toolrail-spawn.test.ts`

- [ ] **Step 1: Failing test**

```ts
test('toolrail spawn ships image_node scope for the active node', async () => {
  useEditorStore.setState({
    activeImageNodeId: 'in-7',
    imageNodes: { 'in-7': { id:'in-7', layerIds:['l-a','l-b'], position:{x:0,y:0}, size:{w:1,h:1}, sourceSize:{w:1,h:1} } },
  });
  const spy = vi.spyOn(backendTools, 'propose_widget').mockResolvedValue({} as any);

  await spawnFromToolrail('light');

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    scope: { kind: 'image_node', imageNodeId: 'in-7', layerIds: ['l-a','l-b'] },
  }));
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

In `toolrail-spawn.ts`, replace the scope arg in the `propose_widget` payload:

```ts
const node = useEditorStore.getState().imageNodes[activeImageNodeId!];
const scope: Scope = node
  ? { kind: 'image_node', imageNodeId: node.id, layerIds: [...node.layerIds] }
  : GLOBAL_SCOPE;
```

Mirror the same fix in the Cmd+K palette call site.

- [ ] **Step 4: Run tests, lint, typecheck**

```
npm run test -- src/lib/__tests__/toolrail-spawn.test.ts && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/toolrail-spawn.ts src/components/EditorDialog.tsx src/lib/__tests__/toolrail-spawn.test.ts
git commit -m "feat(frontend): toolrail + Cmd+K emit image_node scope for active node"
```

---

## Task 9: Frontend — Layers panel scoped to active node

**Why:** Today the layers panel may show all layers across all image nodes; with N nodes, it must show only the active node's `layerIds`.

**Files:**
- Modify: `src/components/panels/LayersPanel.tsx` (or whichever file lists layers)
- Test: extend the panel test

- [ ] **Step 1: Failing test**

```tsx
test('LayersPanel shows only the active image node’s layers', () => {
  useEditorStore.setState({
    layers: [
      { id:'l1', type:'image', name:'A', visible:true, opacity:1, blendMode:'normal', locked:false, order:0 },
      { id:'l2', type:'image', name:'B', visible:true, opacity:1, blendMode:'normal', locked:false, order:1 },
    ],
    imageNodes: {
      'in-1': { id:'in-1', layerIds:['l1'], position:{x:0,y:0}, size:{w:1,h:1}, sourceSize:{w:1,h:1} },
      'in-2': { id:'in-2', layerIds:['l2'], position:{x:0,y:0}, size:{w:1,h:1}, sourceSize:{w:1,h:1} },
    },
    activeImageNodeId: 'in-1',
  });
  render(<LayersPanel />);
  expect(screen.getByText('A')).toBeInTheDocument();
  expect(screen.queryByText('B')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement**

In `LayersPanel.tsx`, filter layers by `imageNodes[activeImageNodeId].layerIds`:

```ts
const layers = useEditorStore((s) => {
  const node = s.activeImageNodeId ? s.imageNodes[s.activeImageNodeId] : null;
  if (!node) return [];
  const idSet = new Set(node.layerIds);
  return s.layers.filter((l) => idSet.has(l.id));
});
```

- [ ] **Step 4: Run tests, lint, typecheck, manual check**

```
npm run test -- LayersPanel && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/LayersPanel.tsx
git commit -m "feat(panels): LayersPanel scopes to active image node’s layers"
```

---

## Task 10: End-to-end verification

**Why:** Sanity-check the whole loop with a real backend session, not just unit tests.

- [ ] **Step 1: Start backend and dev server**

```
cd backend && uvicorn app.main:app --reload
# in another shell:
npm run dev
```

- [ ] **Step 2: Manual checklist (run through each, screenshot if any breaks)**

- [ ] Open image A via File → Open (`⌘O`)
- [ ] Adjust exposure via toolrail → widget tethers to A only
- [ ] Add image B via File → Add image (`⌘⇧O`)
- [ ] Confirm B appears to the right of A, B's source size honoured
- [ ] Run "Analyse" on B → image_context appears in Info tab for B only
- [ ] Adjust exposure on B → does not affect A's render
- [ ] Drag layer panel → only shows the currently active node's layers
- [ ] Split a layer off B → new ImageNode appears with that single layer; existing widgets stay on B's remaining layers
- [ ] Merge the split node back into B → layer returns; tether widgets re-point at B
- [ ] Delete B → A remains untouched; B's widgets disappear

- [ ] **Step 3: If any check fails**

File a bug against this delta plan and triage. Do not commit until the loop is green.

- [ ] **Step 4: Mark plan complete**

Update `docs/superpowers/ENGINE-STATUS.md` if it tracks multi-image status. Commit any doc touch-up.

```bash
git add docs/
git commit -m "docs: mark multi-image canvas delta plan as complete"
```

---

## Out of scope (explicit)

- Persisting workspace positions to `.edp` files — tracked separately.
- Splitting an existing single layer into multiple sub-layers (different from splitting one layer off a multi-layer ImageNode).
- Cross-ImageNode tether edges that carry workflow semantics — tethers remain attribution-only.
- Multi-document tabs in the chrome — out of scope; this is one session with N images.
- Replacing the Layers panel with an in-node stack strip — keep the panel for v1; revisit after this delta lands.
