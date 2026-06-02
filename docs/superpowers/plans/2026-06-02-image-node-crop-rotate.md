# Image-Node Crop &amp; Rotate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-destructive crop and rotate for image nodes — instant 90°/flip from a header dropdown, modal overlay for free crop and straighten.

**Architecture:** Two new structural op-graph node types (`crop`, `rotate`) live in the backend snapshot, scoped to an image node via `Node.layer_ids`. `SessionDocument` gains an `image_node_transforms` dict that `project_to_graph` emits as nodes. A new REST tool `set_image_node_transform` upserts (or clears) the pair. The frontend renders crop and rotate as CSS transforms / `clip-path` on the existing image-node canvas — non-destructive, no WebGL changes for MVP. A `CropOverlay` modal manages staged transforms locally; Apply calls the tool, Cancel discards.

**Tech Stack:** Python + FastAPI + Pydantic (backend), React 19 + TypeScript + Zustand + React Flow (frontend), Vitest + RTL + pytest.

---

## File Structure

**Frontend (new):**
- `src/components/workspace/CropOverlay.tsx` — modal overlay with handles + toolbar.
- `src/components/workspace/CropOverlay.test.tsx`

**Frontend (modified):**
- `src/types/graph.ts` — add `'rotate'` to `STRUCTURAL_NODE_TYPES`.
- `src/components/workspace/ImageNode.tsx` — header dropdown gains Crop/Rotate/Flip items.
- `src/components/workspace/ImageNodeBody.tsx` — apply rotate/crop CSS transforms from snapshot (and optional preview override).
- `src/components/workspace/CanvasWorkspace.tsx` — mount `CropOverlay` when modal state is set.
- `src/store/tool-slice.ts` — `cropModalImageNodeId` state + setter.
- `src/lib/backend-tools.ts` — `set_image_node_transform` wrapper.

**Backend (new):**
- `backend/app/tools/atomic/set_image_node_transform.py` — the new tool.
- `backend/tests/tools/atomic/test_set_image_node_transform.py`

**Backend (modified):**
- `backend/app/state/document.py` — add `image_node_transforms` field + accessor.
- `backend/app/state/operations.py` — `project_to_graph` emits crop/rotate nodes.
- `backend/app/tools/atomic/__init__.py` — register the new tool.

---

### Task 1: Add `'rotate'` to `STRUCTURAL_NODE_TYPES`

**Files:**
- Modify: `src/types/graph.ts`

- [ ] **Step 1: Extend the literal tuple**

Edit `src/types/graph.ts`, line 10:

```ts
export const STRUCTURAL_NODE_TYPES = ['source', 'blend', 'crop', 'rotate', 'output'] as const;
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types/graph.ts
git commit -m "feat(types): add 'rotate' to STRUCTURAL_NODE_TYPES"
```

---

### Task 2: Backend — `image_node_transforms` storage on `SessionDocument`

**Files:**
- Modify: `backend/app/state/document.py`

- [ ] **Step 1: Add the storage field and a setter**

In `backend/app/state/document.py`, add a typed alias near the top imports:

```python
ImageNodeTransform = dict[str, Any]  # {"layer_ids": list[str], "crop": dict|None, "rotate": dict|None}
```

In the `SessionDocument` class body, alongside `canonical: Canonical`, add:

```python
image_node_transforms: dict[str, ImageNodeTransform] = field(default_factory=dict)
```

Add a method near `set_param`:

```python
def set_image_node_transform(
    self,
    image_node_id: str,
    layer_ids: list[str],
    crop: dict | None,
    rotate: dict | None,
) -> list[StateEvent]:
    """Upsert crop/rotate for an image node. If both crop and rotate are
    None, remove the entry entirely so the projection emits no nodes."""
    if crop is None and rotate is None:
        self.image_node_transforms.pop(image_node_id, None)
    else:
        self.image_node_transforms[image_node_id] = {
            "layer_ids": list(layer_ids),
            "crop": crop,
            "rotate": rotate,
        }
    return [self._emit("image_node_transform.updated", {
        "image_node_id": image_node_id,
        "operation_graph": self._op_graph_payload(),
    })]
```

If `SessionDocument` is a regular class (not dataclass), set `self.image_node_transforms = {}` in `__init__` instead of using `field(default_factory=...)`. Check the existing definition style and follow it.

- [ ] **Step 2: Verify the file still imports cleanly**

Run: `cd backend && python -c "from app.state.document import SessionDocument; d = SessionDocument(); print(d.image_node_transforms)"`
Expected: `{}` printed; no error.

- [ ] **Step 3: Commit**

```bash
git add backend/app/state/document.py
git commit -m "feat(backend): SessionDocument carries per-image-node transforms"
```

---

### Task 3: Backend — project crop/rotate transforms into op-graph nodes

**Files:**
- Modify: `backend/app/state/operations.py`

- [ ] **Step 1: Add the failing test first**

Create `backend/tests/state/test_image_node_transform_projection.py`:

```python
from app.state.document import SessionDocument
from app.state.operations import project_to_graph


def test_crop_emits_image_node_scope_node() -> None:
    doc = SessionDocument()
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1", "l-2"],
        "crop": {"x": 10, "y": 20, "w": 100, "h": 80},
        "rotate": None,
    }
    g = project_to_graph(doc)
    crop_nodes = [n for n in g.nodes if n.type == "crop"]
    assert len(crop_nodes) == 1
    n = crop_nodes[0]
    assert n.params == {"x": 10, "y": 20, "w": 100, "h": 80}
    assert n.layer_ids == ["l-1", "l-2"]
    assert n.layer_id == "l-1"  # legacy required field — first layer.


def test_rotate_emits_image_node_scope_node() -> None:
    doc = SessionDocument()
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1"],
        "crop": None,
        "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
    }
    g = project_to_graph(doc)
    rotate_nodes = [n for n in g.nodes if n.type == "rotate"]
    assert len(rotate_nodes) == 1
    assert rotate_nodes[0].params == {"angle": 90.0, "flip_h": False, "flip_v": False}


def test_both_crop_and_rotate_emit_two_nodes() -> None:
    doc = SessionDocument()
    doc.image_node_transforms["in-1"] = {
        "layer_ids": ["l-1"],
        "crop": {"x": 0, "y": 0, "w": 100, "h": 100},
        "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
    }
    g = project_to_graph(doc)
    types = sorted(n.type for n in g.nodes)
    assert "crop" in types and "rotate" in types
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/state/test_image_node_transform_projection.py -v`
Expected: FAIL — projection doesn't emit crop/rotate nodes yet.

- [ ] **Step 3: Update `project_to_graph` to emit them**

In `backend/app/state/operations.py`, inside `project_to_graph`, after the existing list-comprehension that builds `nodes` from `canonical_to_nodes`:

```python
nodes = [
    Node(
        id=nd["id"],
        type=nd["type"],
        scope=global_scope,
        params=nd["params"],
        inputs=[],
        layer_id=nd["layer_id"],
        layer_ids=None,
        widget_id=None,
    )
    for nd in canonical_to_nodes(doc.canonical)
]

# Image-node-scope structural transforms (crop / rotate).
for image_node_id, t in doc.image_node_transforms.items():
    layer_ids = list(t.get("layer_ids") or [])
    if not layer_ids:
        continue
    primary = layer_ids[0]
    crop = t.get("crop")
    if crop is not None:
        nodes.append(Node(
            id=f"transform:{image_node_id}:crop",
            type="crop",
            scope=global_scope,
            params=dict(crop),
            inputs=[],
            layer_id=primary,
            layer_ids=layer_ids,
            widget_id=None,
        ))
    rotate = t.get("rotate")
    if rotate is not None:
        nodes.append(Node(
            id=f"transform:{image_node_id}:rotate",
            type="rotate",
            scope=global_scope,
            params=dict(rotate),
            inputs=[],
            layer_id=primary,
            layer_ids=layer_ids,
            widget_id=None,
        ))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && pytest tests/state/test_image_node_transform_projection.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/operations.py backend/tests/state/test_image_node_transform_projection.py
git commit -m "feat(backend): project image-node transforms into op-graph nodes"
```

---

### Task 4: Backend — `set_image_node_transform` tool

**Files:**
- Create: `backend/app/tools/atomic/set_image_node_transform.py`
- Create: `backend/tests/tools/atomic/test_set_image_node_transform.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/atomic/test_set_image_node_transform.py`:

```python
"""set_image_node_transform — REST-only upsert of crop/rotate nodes for an
image node. Sending both crop=None and rotate=None removes the entry."""
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.tools.atomic.set_image_node_transform import SetImageNodeTransformTool


def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "set_image_node_transform" not in reg._tools:
        reg.register(SetImageNodeTransformTool())
    return TestClient(app)


def _new_session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


def test_upsert_crop_only() -> None:
    client = _client()
    sid = _new_session(client)
    r = client.post("/api/tools/set_image_node_transform", json={
        "session_id": sid, "input": {
            "image_node_id": "in-1",
            "layer_ids": ["layer_a"],
            "crop": {"x": 10, "y": 20, "w": 100, "h": 80},
            "rotate": None,
        },
    })
    assert r.status_code == 200 and r.json()["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.image_node_transforms["in-1"]["crop"] == {"x": 10, "y": 20, "w": 100, "h": 80}
    assert doc.image_node_transforms["in-1"]["rotate"] is None


def test_upsert_rotate_only() -> None:
    client = _client()
    sid = _new_session(client)
    client.post("/api/tools/set_image_node_transform", json={
        "session_id": sid, "input": {
            "image_node_id": "in-1",
            "layer_ids": ["layer_a"],
            "crop": None,
            "rotate": {"angle": 90.0, "flip_h": False, "flip_v": False},
        },
    })
    doc = deps.get_session_store().get_document(sid)
    assert doc.image_node_transforms["in-1"]["rotate"]["angle"] == 90.0


def test_clear_removes_entry_when_both_none() -> None:
    client = _client()
    sid = _new_session(client)
    body = {"session_id": sid, "input": {
        "image_node_id": "in-1", "layer_ids": ["layer_a"],
        "crop": {"x": 0, "y": 0, "w": 1, "h": 1}, "rotate": None,
    }}
    client.post("/api/tools/set_image_node_transform", json=body)
    body["input"]["crop"] = None
    client.post("/api/tools/set_image_node_transform", json=body)
    doc = deps.get_session_store().get_document(sid)
    assert "in-1" not in doc.image_node_transforms
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && pytest tests/tools/atomic/test_set_image_node_transform.py -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the tool**

Create `backend/app/tools/atomic/set_image_node_transform.py`:

```python
"""set_image_node_transform — upsert (or clear) crop and rotate transforms for
an image node. REST-only — invoked by the frontend image-node header dropdown
and the CropOverlay modal. Both crop and None clears the entry; sending only
a delta replaces the prior value for that key."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _CropRect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: int
    y: int
    w: int = Field(gt=0)
    h: int = Field(gt=0)


class _RotateState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    angle: float
    flip_h: bool = False
    flip_v: bool = False


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_node_id: str = Field(min_length=1)
    layer_ids: list[str] = Field(min_length=1)
    crop: _CropRect | None = None
    rotate: _RotateState | None = None


class _Output(BaseModel):
    ok: bool


class SetImageNodeTransformTool(BackendTool[_Input, _Output]):
    name = "set_image_node_transform"
    kind = "mutate"
    description = (
        "Upsert non-destructive crop / rotate for an image node. "
        "Both crop=None and rotate=None clears the entry. REST-only."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.set_image_node_transform(
            input.image_node_id,
            input.layer_ids,
            input.crop.model_dump() if input.crop else None,
            input.rotate.model_dump() if input.rotate else None,
        )
        return _Output(ok=True)
```

- [ ] **Step 4: Register the tool**

Open `backend/app/tools/atomic/__init__.py`. Add an import alongside the existing atomic tools and register inside the registration function (follow the existing pattern — match how the other atomic tools register):

```python
from .set_image_node_transform import SetImageNodeTransformTool
# … inside the registration function:
registry.register(SetImageNodeTransformTool())
```

If the `__init__.py` doesn't have a registration function, look at `backend/app/tools/widgets/__init__.py` for the pattern and follow whatever convention `atomic/__init__.py` already uses.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && pytest tests/tools/atomic/test_set_image_node_transform.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tools/atomic/set_image_node_transform.py \
        backend/app/tools/atomic/__init__.py \
        backend/tests/tools/atomic/test_set_image_node_transform.py
git commit -m "feat(backend): set_image_node_transform tool upserts crop/rotate"
```

---

### Task 5: Frontend — `backendTools.set_image_node_transform` wrapper

**Files:**
- Modify: `src/lib/backend-tools.ts`

- [ ] **Step 1: Add the wrapper**

In `src/lib/backend-tools.ts`, inside the `backendTools` object literal, add:

```ts
set_image_node_transform(sessionId: string, args: {
  image_node_id: string;
  layer_ids: string[];
  crop: { x: number; y: number; w: number; h: number } | null;
  rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null;
}) {
  return invokeTool<{ ok: boolean }>('set_image_node_transform', sessionId, args);
},
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/backend-tools.ts
git commit -m "feat(frontend): backendTools.set_image_node_transform wrapper"
```

---

### Task 6: Frontend — `cropModalImageNodeId` UI state on `tool-slice`

**Files:**
- Modify: `src/store/tool-slice.ts`

- [ ] **Step 1: Inspect the existing slice shape**

Open `src/store/tool-slice.ts`. Identify the state interface and the slice creator function.

- [ ] **Step 2: Add the field + setter**

Add to the state interface (next to other UI-only state like `expandedWidgetIds`):

```ts
cropModalImageNodeId: string | null;
setCropModal: (id: string | null) => void;
```

Add to the slice creator's returned object:

```ts
cropModalImageNodeId: null,
setCropModal: (id) => set((state) => { state.cropModalImageNodeId = id; }),
```

(Match the existing immer/zustand pattern of neighbouring setters.)

- [ ] **Step 3: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/store/tool-slice.ts
git commit -m "feat(store): cropModalImageNodeId UI state"
```

---

### Task 7: Renderer — apply rotate as CSS transform, crop as clip-path

**Files:**
- Modify: `src/components/workspace/ImageNodeBody.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `src/components/workspace/ImageNode.test.tsx`:

```tsx
describe('crop & rotate from snapshot', () => {
  it('applies CSS rotate when a rotate node is present for the image node', async () => {
    // Seed a snapshot with a rotate node for this image node.
    useBackendState.setState({
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [],
          metadata: {},
          nodes: [{
            id: 'transform:in-1:rotate', type: 'rotate',
            scope: { kind: 'global' }, params: { angle: 90, flip_h: false, flip_v: false },
            inputs: [], layer_id: 'l-1', layer_ids: ['l-1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.transform).toContain('rotate(90deg)');
  });
});
```

(Import `useBackendState` at the top of the file if not already.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "crop & rotate from snapshot"`
Expected: FAIL — no rotate CSS is applied yet.

- [ ] **Step 3: Read the current `ImageNodeBody.tsx`**

Open `src/components/workspace/ImageNodeBody.tsx` and locate the rendered `<canvas>` element.

- [ ] **Step 4: Add a hook that reads transforms for this image node**

Above the component, add:

```tsx
import { useBackendState } from '@/store/backend-state-slice';

interface ImageNodeTransforms {
  rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null;
  crop: { x: number; y: number; w: number; h: number } | null;
}

function useImageNodeTransforms(imageNodeId: string): ImageNodeTransforms {
  return useBackendState((s) => {
    const nodes = s.snapshot?.operation_graph.nodes ?? [];
    const rotateNode = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
    const cropNode = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
    return {
      rotate: rotateNode ? rotateNode.params as ImageNodeTransforms['rotate'] : null,
      crop: cropNode ? cropNode.params as ImageNodeTransforms['crop'] : null,
    };
  });
}
```

- [ ] **Step 5: Apply rotate as CSS transform + crop as `clip-path` on the canvas**

Inside the component, compute the styles from the snapshot read:

```tsx
const t = useImageNodeTransforms(imageNodeId);

const cssTransform = (() => {
  const parts: string[] = [];
  if (t.rotate) {
    if (t.rotate.flip_h) parts.push('scaleX(-1)');
    if (t.rotate.flip_v) parts.push('scaleY(-1)');
    parts.push(`rotate(${t.rotate.angle}deg)`);
  }
  return parts.join(' ') || undefined;
})();

const clipPath = t.crop
  ? `inset(${t.crop.y}px ${width - (t.crop.x + t.crop.w)}px ${height - (t.crop.y + t.crop.h)}px ${t.crop.x}px)`
  : undefined;
```

Apply to the canvas element's style: `style={{ transform: cssTransform, clipPath, transformOrigin: 'center center' }}`.

(Preview-time override comes in Task 12, where `useImageNodeTransforms` is extended to merge in `cropPreview`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "crop & rotate from snapshot"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/ImageNodeBody.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): apply rotate/crop from snapshot as CSS transforms"
```

---

### Task 8: ImageNode header dropdown — Rotate 90° / Flip items (instant commit)

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `src/components/workspace/ImageNode.test.tsx`:

```tsx
import { vi } from 'vitest';
import { backendTools } from '@/lib/backend-tools';

describe('header dropdown transform items', () => {
  it('Rotate 90° CW calls set_image_node_transform with angle +90 delta', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useBackendState.setState({ sessionId: 'sess-1' } as never);

    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    await userEvent.click(screen.getByLabelText('Split or merge'));
    await userEvent.click(screen.getByText('Rotate 90° CW'));

    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['l-1'],
      rotate: expect.objectContaining({ angle: 90 }),
    }));
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "header dropdown transform items"`
Expected: FAIL — the menu item does not exist.

- [ ] **Step 3: Add the items**

In `src/components/workspace/ImageNode.tsx`, inside the `<DropdownMenu.Content>`, add four items above the existing "Delete" item:

```tsx
<DropdownMenu.Item
  className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
    text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
  onSelect={() => handleTransformDelta({ angle: +90 })}
>
  Rotate 90° CW
</DropdownMenu.Item>
<DropdownMenu.Item
  className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
    text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
  onSelect={() => handleTransformDelta({ angle: -90 })}
>
  Rotate 90° CCW
</DropdownMenu.Item>
<DropdownMenu.Item
  className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
    text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
  onSelect={() => handleTransformDelta({ flip_h: true })}
>
  Flip Horizontal
</DropdownMenu.Item>
<DropdownMenu.Item
  className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
    text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
  onSelect={() => handleTransformDelta({ flip_v: true })}
>
  Flip Vertical
</DropdownMenu.Item>
```

Add the handler near `handleSplit`:

```tsx
function handleTransformDelta(delta: { angle?: number; flip_h?: boolean; flip_v?: boolean }) {
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  const nodes = useBackendState.getState().snapshot?.operation_graph.nodes ?? [];
  const prevRotate = nodes.find((n) => n.id === `transform:${id}:rotate`)?.params as
    | { angle: number; flip_h: boolean; flip_v: boolean } | undefined;
  const prevCrop = nodes.find((n) => n.id === `transform:${id}:crop`)?.params as
    | { x: number; y: number; w: number; h: number } | undefined;
  const base = prevRotate ?? { angle: 0, flip_h: false, flip_v: false };
  const next = {
    angle: ((base.angle + (delta.angle ?? 0)) % 360 + 360) % 360,
    flip_h: delta.flip_h ? !base.flip_h : base.flip_h,
    flip_v: delta.flip_v ? !base.flip_v : base.flip_v,
  };
  void backendTools.set_image_node_transform(sessionId, {
    image_node_id: id,
    layer_ids: data.layerIds,
    crop: prevCrop ?? null,
    rotate: next,
  });
}
```

Import `backendTools` and `useBackendState` at the top if not already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "header dropdown transform items"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): header dropdown rotate 90° / flip items"
```

---

### Task 9: Add `Crop…` dropdown item that opens the modal state

**Files:**
- Modify: `src/components/workspace/ImageNode.tsx`
- Modify: `src/components/workspace/ImageNode.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `src/components/workspace/ImageNode.test.tsx`:

```tsx
describe('Crop… menu item', () => {
  it('sets cropModalImageNodeId on the store', async () => {
    useEditorStore.setState({ cropModalImageNodeId: null } as never);
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    await userEvent.click(screen.getByLabelText('Split or merge'));
    await userEvent.click(screen.getByText('Crop…'));
    expect(useEditorStore.getState().cropModalImageNodeId).toBe('in-1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "Crop… menu item"`
Expected: FAIL — item does not exist.

- [ ] **Step 3: Add the item**

Add `Crop…` as the first transform item in `<DropdownMenu.Content>` (above Rotate):

```tsx
<DropdownMenu.Item
  className="px-2 py-1 text-[10px] rounded-sm cursor-pointer outline-none
    text-text-primary hover:bg-surface-secondary focus:bg-surface-secondary"
  onSelect={() => useEditorStore.getState().setCropModal(id)}
>
  Crop…
</DropdownMenu.Item>
```

Import `useEditorStore` at the top if not already.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/workspace/ImageNode.test.tsx -t "Crop… menu item"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/ImageNode.tsx src/components/workspace/ImageNode.test.tsx
git commit -m "feat(image-node): Crop… menu item enters modal state"
```

---

### Task 10: `CropOverlay` — skeleton (toolbar + Apply/Cancel)

**Files:**
- Create: `src/components/workspace/CropOverlay.tsx`
- Create: `src/components/workspace/CropOverlay.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/workspace/CropOverlay.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CropOverlay } from './CropOverlay';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

afterEach(cleanup);

const baseProps = {
  imageNodeId: 'in-1',
  layerIds: ['l-1'],
  width: 800,
  height: 600,
};

describe('CropOverlay skeleton', () => {
  it('renders the toolbar with aspect chips and Apply/Cancel', () => {
    render(<CropOverlay {...baseProps} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('Cancel clears cropModalImageNodeId and does NOT call the backend tool', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(useEditorStore.getState().cropModalImageNodeId).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Apply calls set_image_node_transform with the current crop rect and clears modal', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useBackendState.setState({ sessionId: 'sess-1' } as never);
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    await userEvent.click(screen.getByText('Apply'));
    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['l-1'],
    }));
    expect(useEditorStore.getState().cropModalImageNodeId).toBeNull();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx`
Expected: FAIL — `CropOverlay` does not exist.

- [ ] **Step 3: Implement the skeleton**

Create `src/components/workspace/CropOverlay.tsx`:

```tsx
import { useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

interface CropOverlayProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

interface CropRect { x: number; y: number; w: number; h: number; }

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '16:9', ratio: 16 / 9 },
];

export function CropOverlay({ imageNodeId, layerIds, width, height }: CropOverlayProps) {
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: width, h: height });
  const [aspect, setAspect] = useState<number | null>(null);
  const [angle, setAngle] = useState(0);

  function handleAspect(ratio: number | null) {
    setAspect(ratio);
    if (ratio === null) return;
    const newH = Math.round(crop.w / ratio);
    setCrop({ ...crop, h: Math.min(newH, height - crop.y) });
  }

  function handleApply() {
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    void backendTools.set_image_node_transform(sessionId, {
      image_node_id: imageNodeId,
      layer_ids: layerIds,
      crop,
      rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
    });
    useEditorStore.getState().setCropModal(null);
  }

  function handleCancel() {
    useEditorStore.getState().setCropModal(null);
  }

  return (
    <div className="absolute inset-0 pointer-events-none" data-testid="crop-overlay">
      <div className="overlay absolute left-1/2 -top-10 -translate-x-1/2 px-2 py-1 flex items-center gap-1 pointer-events-auto text-[10px]">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => handleAspect(a.ratio)}
            className={`px-1.5 py-0.5 rounded-[3px] ${aspect === a.ratio ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'}`}
          >
            {a.label}
          </button>
        ))}
        <span className="w-px h-3 bg-separator mx-1" />
        <label className="flex items-center gap-1 text-text-secondary">
          Straighten
          <input
            type="range"
            min={-45}
            max={45}
            step={0.1}
            value={angle}
            onChange={(e) => setAngle(parseFloat(e.target.value))}
            className="w-20"
          />
          <span className="num w-8 text-right">{angle.toFixed(1)}°</span>
        </label>
        <span className="w-px h-3 bg-separator mx-1" />
        <button
          type="button"
          onClick={handleApply}
          className="px-2 py-0.5 rounded-[3px] bg-accent text-white"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="px-2 py-0.5 rounded-[3px] bg-surface-secondary text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CropOverlay.tsx src/components/workspace/CropOverlay.test.tsx
git commit -m "feat(crop): CropOverlay toolbar with aspect chips, straighten, Apply/Cancel"
```

---

### Task 11: `CropOverlay` — draggable corner handles

**Files:**
- Modify: `src/components/workspace/CropOverlay.tsx`
- Modify: `src/components/workspace/CropOverlay.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `CropOverlay.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';

describe('CropOverlay corner handles', () => {
  it('renders four corner handles', () => {
    render(<CropOverlay {...baseProps} />);
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(4);
  });

  it('dragging the bottom-right handle resizes the crop rect', () => {
    render(<CropOverlay {...baseProps} />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 800, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    // bottom-right moved up-left by 100,100 → new w=700, h=500
    const mask = document.querySelector('[data-testid="crop-mask"]') as HTMLElement;
    expect(mask.style.getPropertyValue('--crop-w')).toBe('700');
    expect(mask.style.getPropertyValue('--crop-h')).toBe('500');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx -t "corner handles"`
Expected: FAIL — no handle elements.

- [ ] **Step 3: Add the rect + corner handles**

In `CropOverlay.tsx`, inside the root `<div>`, after the toolbar, add:

```tsx
<div
  data-testid="crop-mask"
  className="absolute pointer-events-none border border-accent"
  style={{
    left: crop.x, top: crop.y, width: crop.w, height: crop.h,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
    ['--crop-w' as string]: String(crop.w),
    ['--crop-h' as string]: String(crop.h),
  }}
>
  {(['tl','tr','bl','br'] as const).map((corner) => (
    <div
      key={corner}
      data-handle={corner}
      className="absolute w-2.5 h-2.5 bg-surface border-[1.5px] border-accent pointer-events-auto cursor-nwse-resize"
      style={{
        left:  corner.endsWith('l') ? -5 : undefined,
        right: corner.endsWith('r') ? -5 : undefined,
        top:    corner.startsWith('t') ? -5 : undefined,
        bottom: corner.startsWith('b') ? -5 : undefined,
      }}
      onPointerDown={(e) => startDrag(e, corner)}
    />
  ))}
</div>
```

Add the drag handler inside the component:

```tsx
function startDrag(e: React.PointerEvent, corner: 'tl' | 'tr' | 'bl' | 'br') {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const start = crop;
  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    setCrop(applyCornerDelta(start, corner, dx, dy, width, height));
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}
```

Add a pure helper above the component (testable in isolation if needed later):

```tsx
function applyCornerDelta(
  start: CropRect, corner: 'tl' | 'tr' | 'bl' | 'br',
  dx: number, dy: number, maxW: number, maxH: number,
): CropRect {
  let { x, y, w, h } = start;
  if (corner === 'tl') { x += dx; y += dy; w -= dx; h -= dy; }
  if (corner === 'tr') { y += dy; w += dx; h -= dy; }
  if (corner === 'bl') { x += dx; w -= dx; h += dy; }
  if (corner === 'br') { w += dx; h += dy; }
  x = Math.max(0, Math.min(x, maxW - 1));
  y = Math.max(0, Math.min(y, maxH - 1));
  w = Math.max(1, Math.min(w, maxW - x));
  h = Math.max(1, Math.min(h, maxH - y));
  return { x, y, w, h };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx -t "corner handles"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CropOverlay.tsx src/components/workspace/CropOverlay.test.tsx
git commit -m "feat(crop): four corner handles drag the crop rect"
```

---

### Task 12: `CropOverlay` — live preview through `ImageNodeBody.previewTransform`

**Files:**
- Modify: `src/components/workspace/CropOverlay.tsx`
- Modify: `src/components/workspace/ImageNodeBody.tsx`

- [ ] **Step 1: Expose preview state outside the overlay**

In `tool-slice.ts`, extend the slice (alongside `cropModalImageNodeId`):

```ts
cropPreview: { crop: { x: number; y: number; w: number; h: number } | null;
               rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null } | null;
setCropPreview: (
  p: { crop: { x: number; y: number; w: number; h: number } | null;
       rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null } | null
) => void;
```

…and in the slice creator:

```ts
cropPreview: null,
setCropPreview: (p) => set((state) => { state.cropPreview = p; }),
```

- [ ] **Step 2: Have `CropOverlay` write its staged transforms there**

In `CropOverlay.tsx`, add an `useEffect` that mirrors local `crop` + `angle` into the store:

```tsx
useEffect(() => {
  useEditorStore.getState().setCropPreview({
    crop,
    rotate: angle !== 0 ? { angle, flip_h: false, flip_v: false } : null,
  });
  return () => { useEditorStore.getState().setCropPreview(null); };
}, [crop, angle]);
```

Also clear it on Apply and Cancel — replace `handleApply` and `handleCancel` so they call `setCropPreview(null)` before/after their existing actions.

- [ ] **Step 3: Extend `useImageNodeTransforms` (in `ImageNodeBody.tsx`) to merge preview**

Replace the existing `useImageNodeTransforms` implementation from Task 7 with:

```tsx
function useImageNodeTransforms(imageNodeId: string): ImageNodeTransforms {
  const fromSnapshot = useBackendState((s) => {
    const nodes = s.snapshot?.operation_graph.nodes ?? [];
    const rotateNode = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
    const cropNode = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
    return {
      rotate: rotateNode ? rotateNode.params as ImageNodeTransforms['rotate'] : null,
      crop: cropNode ? cropNode.params as ImageNodeTransforms['crop'] : null,
    };
  });
  const previewActive = useEditorStore((s) => s.cropModalImageNodeId === imageNodeId);
  const preview = useEditorStore((s) => s.cropPreview);
  if (!previewActive || !preview) return fromSnapshot;
  return {
    rotate: preview.rotate ?? fromSnapshot.rotate,
    crop:   preview.crop   ?? fromSnapshot.crop,
  };
}
```

Import `useEditorStore` at the top of the file if not already.

- [ ] **Step 4: Verify build still passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tool-slice.ts src/components/workspace/CropOverlay.tsx src/components/workspace/ImageNodeBody.tsx
git commit -m "feat(crop): live preview via cropPreview store hand-off"
```

---

### Task 13: Mount `CropOverlay` from `CanvasWorkspace`

**Files:**
- Modify: `src/components/workspace/CanvasWorkspace.tsx`

- [ ] **Step 1: Read the current `CanvasWorkspace.tsx`**

Open the file. Identify where overlays/portals mount over the React Flow viewport.

- [ ] **Step 2: Conditionally render the overlay**

Near the end of the rendered JSX (inside the React Flow container), add:

```tsx
{(() => {
  const cropId = useEditorStore.getState().cropModalImageNodeId;
  if (!cropId) return null;
  const node = imageNodes[cropId];
  if (!node) return null;
  // Position the overlay over the node's bounds — mount at the workspace
  // viewport level so React Flow's pan/zoom transform applies to it.
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: node.position.x, top: node.position.y, width: node.size.w, height: node.size.h }}
    >
      <CropOverlay
        imageNodeId={cropId}
        layerIds={node.layerIds}
        width={node.size.w}
        height={node.size.h}
      />
    </div>
  );
})()}
```

Replace `useEditorStore.getState().cropModalImageNodeId` with a proper subscription:

```tsx
const cropModalId = useEditorStore((s) => s.cropModalImageNodeId);
// …and use cropModalId inside the IIFE instead of getState().
```

Import `CropOverlay`.

- [ ] **Step 3: Verify build passes**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/workspace/CanvasWorkspace.tsx
git commit -m "feat(workspace): mount CropOverlay when cropModalImageNodeId is set"
```

---

### Task 14: Keyboard shortcuts — Enter applies, Esc cancels

**Files:**
- Modify: `src/components/workspace/CropOverlay.tsx`
- Modify: `src/components/workspace/CropOverlay.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `CropOverlay.test.tsx`:

```tsx
describe('CropOverlay keyboard', () => {
  it('Enter applies', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useBackendState.setState({ sessionId: 'sess-1' } as never);
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Escape cancels without calling the backend tool', () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(spy).not.toHaveBeenCalled();
    expect(useEditorStore.getState().cropModalImageNodeId).toBeNull();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx -t "keyboard"`
Expected: FAIL — no keydown handler.

- [ ] **Step 3: Wire the global handler**

In `CropOverlay.tsx`, add inside the component:

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); handleApply(); }
    if (e.key === 'Escape') { e.preventDefault(); handleCancel(); }
  }
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [crop, angle]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/workspace/CropOverlay.test.tsx -t "keyboard"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/CropOverlay.tsx src/components/workspace/CropOverlay.test.tsx
git commit -m "feat(crop): Enter applies / Esc cancels"
```

---

### Task 15: Manual smoke test + final check

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS.

Run: `cd backend && pytest -q`
Expected: PASS.

- [ ] **Step 2: Boot the app and verify end-to-end**

Run: `npm run dev` and start the backend per the project's standard startup.

In the browser:
1. Open an image. Click the image node → open the Split menu → click **Rotate 90° CW**. Verify the canvas rotates 90° immediately and the snapshot's op-graph now contains a `transform:in-*:rotate` node.
2. Click **Rotate 90° CW** three more times. Verify it returns to original orientation (angle wraps via `% 360`).
3. Click **Flip Horizontal**. Verify the image mirrors.
4. Click **Crop…**. The modal toolbar appears above the image node and corner handles appear at the image bounds.
5. Drag the bottom-right corner up-left. Verify the dark mask covers the cropped-away portion in real time.
6. Press **Esc**. Verify the modal closes and the bitmap is back to its full size.
7. Click **Crop…** again, drag handles, click **Apply**. Verify the cropped rect persists. The op-graph now has a `transform:in-*:crop` node.
8. Refresh the page (session restore). Verify crop and rotate persist across reload.

- [ ] **Step 3: Final commit (no-op if nothing changed)**

```bash
git status
# If lint/typecheck auto-fixed something:
git add -p
git commit -m "chore: post-smoke-test cleanups"
```

---

## Out of Scope (for this plan)

- WebGL-level crop/rotate that survives export (the snapshot carries truth; CSS transforms cover live display only). A follow-up plan replaces the CSS preview with a real rendering pass.
- Per-layer transform (each layer independently rotatable).
- Aspect-locked dragging — the chips snap dimensions once, but dragging doesn't enforce the ratio. Easy follow-up.
- Straighten using outside-corner rotation gesture (Figma-style). The slider covers the use case for MVP.
- Crop affecting layer masks / segmentation overlays. Out of scope until the renderer rewrite.
