# Phase 4 — SAM Segmentation, Segment Actions & AI Tool-Use Loop — Design

**Date:** 2026-05-15
**Status:** Approved (brainstorm); pending implementation plan
**Builds on:** `2026-05-15-ai-targeted-workflow-design.md` (TargetRef, ai-step nodes, agent palette)
**Companion thesis section:** `2026-05-11-thesis-prototype-implementation-design.md` §Phase 4

## Problem

The editor has Cmd+K → backend → `OperationGraph` → `ai-step` node working end-to-end, but every AI invocation is *global* — the only `Scope` consumed by the runtime is `'global'`. The backend already returns `mask:proposed` scope kinds; the frontend has nowhere to put them. The result is that "darken the sky" affects the whole image.

This spec adds three coupled capabilities:

1. **Segmentation infrastructure** — in-browser SAM ViT-B (ONNX Web), with four selection tools that produce masks stored in a first-class `MaskStore`.
2. **Segment actions** — extract-to-layer (non-destructive branching of the layer/graph), remove-with-AI (Replicate inpainting), edit-with-AI (Cmd+K scoped to a mask), and scope-adjustment (any next adjustment is mask-scoped).
3. **AI tool-use loop** — a new `/api/agent` endpoint that runs an Anthropic tool-use conversation; tools include the segmentation primitives so Claude can compose `analyze → segment → apply` without a manual selection step.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Masks are first-class entities (`MaskStore` + `MaskRef`) — not inline on adjustments | Same mask is referenced by adjustments, layers, and agent tool calls. Centralised storage enables shared scope and clean tool inputs/outputs. |
| 2 | SAM runs in-browser via ONNX Web (ViT-B quantized) | Sub-second decode after one-time ~100 MB download; no per-click backend round-trip; matches thesis spec. |
| 3 | Selection comes from four separate `ToolDefinition`s (point / multi-point / box / brush-mask) | User wants flexibility across use cases; "which tool when" decision is left to UX evaluation. |
| 4 | "Extract to new layer" creates a non-destructive branch: child layer references parent + mask | Parent edits propagate; literal "new branch in tree" via `Layer.parentLayerId`. |
| 5 | "Remove with AI" uses Replicate-hosted inpainting; result lands as a new layer above source | No infra burden; non-destructive (delete the layer to undo). |
| 6 | Agent loop runs on backend with SSE streaming; browser-resident tools (SAM) mediated via `tool_result` POST-back | Claude conversation history lives server-side; in-browser SAM can still participate. |
| 7 | Claude gets all eight tools (analyze, segment_at_point, segment_by_label, apply_panel, extract_to_layer, remove_region, get_layers, add_adjustment) | Full toolbox for thesis evaluation; guardrails are policy-not-architecture. |
| 8 | Cmd+K migrates from `/api/panel` to `/api/agent`; `apply_panel` remains a backend-only tool callable by the agent | Single entry point; no parallel surfaces for users to confuse. |

## Core data model

### `Mask` and `MaskStore`

```ts
// src/core/mask-store.ts (new)

export type MaskSource =
  | 'sam-point'
  | 'sam-points'
  | 'sam-box'
  | 'brush'
  | 'ai-proposed';

export interface SamPrompt {
  kind: 'point' | 'box';
  /** Point: [x, y, label] where label = 1 (positive) | 0 (negative). Box: [x1,y1,x2,y2]. */
  data: number[];
}

export interface Mask {
  id: string;
  label?: string;                  // "sky", "subject" — from AI or user
  width: number;
  height: number;                  // full-image resolution
  data: Uint8Array;                // single-channel alpha 0–255, length = w*h
  source: MaskSource;
  prompts?: SamPrompt[];           // points/box that produced it, for refinement
  layerId: string;                 // image the mask was authored against
  createdAt: number;
}

export type MaskRef = string;

class MaskStoreImpl {
  private masks = new Map<MaskRef, Mask>();
  register(mask: Mask): MaskRef { /* sets id, stores, returns id */ }
  get(ref: MaskRef): Mask | undefined { return this.masks.get(ref); }
  remove(ref: MaskRef): boolean { return this.masks.delete(ref); }
  clear(): void { this.masks.clear(); }
  async exportPng(ref: MaskRef): Promise<Blob> { /* encode alpha as 8-bit PNG */ }
  async importPng(ref: MaskRef, blob: Blob, meta: Omit<Mask, 'id'|'data'>): Promise<void> { /* … */ }
}

export const maskStore = new MaskStoreImpl();
```

### Typed `Scope` discriminated union

Current `ScopeKind` in `src/types/operation-graph.ts` is a loose union of strings. Replace with:

```ts
// src/types/scope.ts (new)
export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; maskRef: MaskRef }
  | { kind: 'mask:proposed'; label: string; representativePoint: [number, number] };
```

`Adjustment.scope?: Scope` (currently absent). Default = `{ kind: 'global' }` when unset.

### `Layer` schema additions

```ts
// src/store/layer-slice.ts — additive only
interface Layer {
  // … existing fields
  parentLayerId?: string;          // present iff this is a branched layer
  layerMask?: MaskRef;             // alpha mask applied at composite time
}
```

`parentLayerId` is immutable after creation. Removing a layer with children is blocked (an error toast tells the user "remove child layers first"). No cascading delete in v1.

### `useSegmentationStore`

```ts
// src/store/segmentation-slice.ts (new)
interface SegmentationState {
  activeMaskRef: MaskRef | null;   // mask currently being authored (live preview)
  committedMaskRef: MaskRef | null; // mask shown by the action bar; null when bar dismissed
  encoderState: 'idle' | 'loading-model' | 'encoding' | 'ready' | 'error';
  modelLoaded: boolean;
}
```

## SAM client

Three files:

### `src/lib/sam/model-loader.ts`

Lazy-fetches ONNX weights on first selection action. Two files: `sam_vit_b_01ec64.encoder.onnx` (~91 MB) and `sam_vit_b_01ec64.decoder.onnx` (~2 MB), both pre-quantized (int8 for encoder, fp16 for decoder). Stored as Blobs in IndexedDB under `sam-models/v1`.

```ts
export async function getEncoder(): Promise<InferenceSession> { /* IDB → fetch → cache */ }
export async function getDecoder(): Promise<InferenceSession> { /* same */ }
```

Initial fetch shows a loading state in the segmentation tool's options panel.

### `src/workers/sam.worker.ts`

Comlink worker exposing:

```ts
class SamWorker {
  async encode(imageBitmap: ImageBitmap): Promise<{ embedding: Float32Array; shape: number[]; layerId: string }>;
  async decode(args: { embedding: Float32Array; shape: number[]; prompts: SamPrompt[] }): Promise<{ data: Uint8Array; width: number; height: number }>;
}
```

Runs ONNX `Session.run()` off the main thread. Decoder output is a 256×256 logit map; we upsample to image dimensions on the main thread (bilinear) before storing as `Mask.data`.

### `src/lib/sam/sam-client.ts`

Facade. Caches embeddings by `(layerId, sourcePixelHash)`:

```ts
export const samClient = {
  async ensureEmbedding(layerId: string): Promise<void>;   // encode if cache miss
  async segment(layerId: string, prompts: SamPrompt[]): Promise<MaskRef>;
  cancelInFlight(): void;
};
```

`segment()` returns a `MaskRef` after registering the resulting `Mask` in `maskStore` with `source` derived from prompt shape (`point` / `points` / `box`).

## Selection tools

Four new `ToolDefinition`s in `src/tools/`:

| File | Tool | Modifier | Commit |
|---|---|---|---|
| `select-point-tool.ts` | `SelectPointTool` | mousedown | mouseup |
| `select-multi-point-tool.ts` | `SelectMultiPointTool` | click positive; ⇧click positive; ⌥click negative | Enter |
| `select-box-tool.ts` | `SelectBoxTool` | drag to define box | mouseup |
| `brush-mask-tool.tsx` | `BrushMaskTool` | mouse drag paints into active mask alpha | n/a (continuous) |

All four share a `MaskOverlay` component (new, `src/components/canvas/MaskOverlay.tsx`) that renders the active mask as a translucent colour overlay on the canvas. Marching-ants outline rendered via a separate overlay layer (Fabric-independent canvas at `z=10`).

State sequence for the three SAM tools:

1. User selects tool → samClient.ensureEmbedding(activeLayerId) kicks off (if not cached).
2. Encoder state visible: "Loading model…" → "Analyzing image…" → "Ready".
3. User interacts → call `samClient.segment(layerId, prompts)` → write resulting `MaskRef` to `useSegmentationStore.activeMaskRef`.
4. `MaskOverlay` re-renders showing the live mask.
5. Commit (mouseup or Enter) → moves the ref from `activeMaskRef` to `committedMaskRef`. Action bar appears.

For `BrushMaskTool`, the input is the *current* mask (either `activeMaskRef` or a copy of `committedMaskRef`). Paint strokes write directly into `Mask.data` and bump a `version` counter so the overlay re-renders.

## Mask compositing in the WebGL pipeline

`src/lib/pipeline-manager.ts` and the per-adjustment fragment shaders gain mask support.

Shader extension (one snippet, included by every existing shader template):

```glsl
uniform sampler2D u_maskTex;
uniform int u_useMask;

vec4 applyMask(vec4 base, vec4 adjusted, vec2 uv) {
  if (u_useMask == 0) return adjusted;
  float a = texture(u_maskTex, uv).r;
  return mix(base, adjusted, a);
}
```

Every shader's `main` ends with `fragColor = applyMask(srcColor, adjustedColor, v_uv);`.

`PipelineManager.applyAdjustment(adj, ...)` checks `adj.scope`:
- `{ kind: 'global' }` → sets `u_useMask = 0`.
- `{ kind: 'mask', maskRef }` → uploads `maskStore.get(maskRef).data` as an R8 texture, binds to `u_maskTex`, sets `u_useMask = 1`.
- `{ kind: 'mask:proposed', ... }` → treated as global for rendering; the proposed scope is a *suggestion* the agent loop may upgrade to a real mask via `segment_by_label`.

`LayerCompositor.renderLayer(layer)` is extended: if `layer.layerMask` is set, the layer's final output is multiplied by the mask alpha before being composited with siblings.

## Layer extraction & graph branching

`src/store/segment-actions.ts` (new) exposes:

```ts
export function extractLayerFromMask(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
  name?: string;
}): string;  // returns new layerId

export function inpaintAndAddLayer(args: {
  sourceLayerId: string;
  maskRef: MaskRef;
}): Promise<string>;
```

`extractLayerFromMask`:
1. Creates a new Layer with `id = uuid()`, `type = 'image'`, `parentLayerId = sourceLayerId`, `layerMask = maskRef`, `adjustmentStack.adjustments = []`.
2. Registers it in the store via `addLayer`.
3. Does NOT create new pixel data — `pixelStore` has no entry for the new layer. Rendering reads parent's pipeline output and multiplies by mask.
4. Sets the new layer as active.

`derived-graph.ts` extensions:
- When building the graph, group layers by `parentLayerId`. Children of layer L become a fan-out at L's output node.
- An edge `L.output → child.source` is added. Child's `source` node label changes from "Source" to "From: <parent name>".
- The Source/Crop chain on a child layer is omitted (its source pixels come from parent, not from pixelStore).

Cycle prevention: `addLayer` rejects a layer whose `parentLayerId` would create a cycle. `removeLayer` rejects a removal that would orphan children (returns an error; consumer shows a toast).

`LayerCompositor.renderLayer(child)`:
```
parent = layers.find(l => l.id === child.parentLayerId)
parentOut = renderLayer(parent)  // recursive
result = applyMask(parentOut, maskStore.get(child.layerMask))
for adj in child.adjustmentStack: result = applyAdjustment(adj, result)
return result
```

## Segment Actions bar

UI component at `src/components/canvas/SegmentActionsBar.tsx`. Renders when `useSegmentationStore.committedMaskRef !== null`. Positioned with Floating UI, anchored to mask bounding box top-edge.

Five interactive elements:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ✨ sky · m_3a    Extract layer · Remove · Edit with AI · Scope · Discard │
└─────────────────────────────────────────────────────────────────────────┘
```

| Action | Handler |
|---|---|
| **Extract layer** | `extractLayerFromMask({ sourceLayerId: activeLayerId, maskRef })`; dismiss bar |
| **Remove** | `inpaintAndAddLayer({...})`; show progress spinner; dismiss bar on success |
| **Edit with AI** | `openPaletteWith({ kind: 'mask', maskRef }, 'append')` (extends existing `TargetRef`) |
| **Scope** | Sets `useSegmentationStore.activeScope = { kind: 'mask', maskRef }`; next adjustment added (from toolbar / inspector) gets this scope; bar shows "scoped — Esc to clear" state |
| **Discard** (Esc) | Clears `committedMaskRef`; does NOT delete the Mask from `maskStore` (kept for undo) |

The Mask itself is not garbage-collected on dismiss; it lives in the store until either explicit cleanup, layer removal, or document close.

The existing `TargetRef` union from the prior spec adds a new variant:

```ts
type TargetRef =
  // existing:
  | { kind: 'layer'; layerId: string }
  | { kind: 'node'; layerId: string; adjustmentId: string }
  | { kind: 'composite' }
  // new:
  | { kind: 'mask'; maskRef: MaskRef };
```

`humanLabelFor({ kind: 'mask', maskRef })` returns `Mask.label ?? 'Selection'`.

`renderTargetSnapshot({ kind: 'mask', maskRef })` renders the host layer's composite, multiplied by the mask, downscaled — gives the AI a clear view of the masked region.

## Inpainting service

### Backend

`backend/app/api/inpaint.py` (new):

```python
class InpaintRequest(BaseModel):
    session_id: str
    target_layer_id: str
    image_png_base64: str
    mask_png_base64: str
    prompt: str | None = None  # optional, for prompted inpainting

class InpaintResponse(BaseModel):
    inpainted_png_base64: str
    model: str
    duration_ms: int

@router.post("/api/inpaint", response_model=InpaintResponse)
async def inpaint(req: InpaintRequest, settings = Depends(get_settings)):
    # Decode inputs.
    # POST to Replicate (e.g. lucataco/sdxl-inpainting or stability-ai/sd-3.5-large).
    # Poll until output url ready; fetch the result PNG.
    # Return base64 PNG.
```

`backend/app/services/replicate_client.py` (new): thin wrapper around `replicate` Python SDK, reads `REPLICATE_API_TOKEN` from settings (added to `Settings` in `config.py`).

Replicate model is fixed for v1 (`stability-ai/sd-3.5-large` or `lucataco/sdxl-inpainting` — engineer picks during implementation based on cost/quality). Model picker is future work.

### Frontend

`src/lib/ai-client.ts` gains:

```ts
export async function inpaintRegion(args: {
  sessionId: string;
  targetLayerId: string;
  imagePng: Blob;     // current layer pixels
  maskPng: Blob;      // mask alpha as PNG
  prompt?: string;
}): Promise<Blob>;    // inpainted PNG
```

`inpaintAndAddLayer` calls this, then creates a new Layer above source whose pixels are the inpainted result (registered to `pixelStore`).

## Agent loop (`/api/agent`)

### Backend

New route `POST /api/agent` (SSE response). Request:

```ts
interface AgentRequest {
  session_id: string;
  user_goal: string;
  target_ref: TargetRef;
  layer_inventory: LayerInventory;  // see below
}
```

`LayerInventory` is the minimum state Claude needs to reason: `{ id, name, type, parentLayerId, layerMask, scope-summary-of-adjustments }[]`. Frontend builds this from its store and ships it with the request — backend has no shared state with the frontend's Zustand store.

Backend conversation:

1. System prompt: editor-aware, describes scopes, layers, and the tool palette.
2. Initial messages: `{ role: 'user', content: [image, goal, inventory] }` with the source image marked `cache_control: ephemeral` and the inventory inline.
3. Loop until Claude's response has no `tool_use`:
   - Inspect `tool_use` block.
   - If tool implementation lives on backend (`analyze_image`, `segment_by_label`, `apply_panel`, `remove_region`, `extract_to_layer`, `add_adjustment`, `get_layers`):
     - Execute; produce `tool_result` content block; append to conversation; continue.
     - Some "execution" produces a side-effect on the frontend store. The backend emits an SSE `state_patch` event the frontend applies; the corresponding `tool_result` to Claude is a confirmation `{ ok: true, layerId?: ..., maskRef?: ... }`.
   - If tool implementation is browser-side (`segment_at_point`):
     - Backend emits SSE `{ type: 'browser_tool', call_id, name, args }`; pauses loop.
     - Frontend executes the tool (`samClient.segment(...)`), then POSTs to `/api/agent/tool_result { call_id, result }`.
     - Backend wakes, appends `tool_result`, continues.
4. On final text: emit SSE `{ type: 'final', summary, side_effects: [...] }`.
5. Close stream.

### Frontend

`src/lib/agent-client.ts` (new):

```ts
export async function runAgent(args: {
  sessionId: string;
  userGoal: string;
  targetRef: TargetRef;
}, callbacks: {
  onStatePatch: (patch: StatePatch) => void;
  onBrowserTool: (call: BrowserToolCall) => Promise<unknown>;
  onFinal: (final: AgentFinal) => void;
  onError: (err: Error) => void;
}): Promise<void>;
```

Streams SSE via `EventSource` (with a polyfill for POST + SSE if needed, since `EventSource` is GET-only — use `@microsoft/fetch-event-source` or similar).

`StatePatch` is a small typed update: e.g. `{ op: 'addLayer', layer: Layer }`, `{ op: 'addAdjustment', layerId, adjustment }`, `{ op: 'registerMask', mask: Mask }`. The frontend applies via store actions.

`BrowserToolCall` for v1 is only `{ name: 'segment_at_point', args: { x, y, layerId } }`. Frontend handler:

```ts
async (call) => {
  const maskRef = await samClient.segment(call.args.layerId, [{ kind: 'point', data: [call.args.x, call.args.y, 1] }]);
  return { maskRef };
}
```

### Cmd+K migration

`App.tsx`'s `handlePaletteSubmit` swaps `generatePanel(...)` for `runAgent(...)`. The result handling reads `AgentFinal.side_effects` to dismiss the palette with a brief summary. The existing `addAiStepNode` call site is removed — adjustments are added via SSE state patches inside the agent loop (the backend's `apply_panel` tool implementation produces the same `OperationGraph` and emits a single `addAdjustment` patch sequence).

`/api/panel` and `/api/refine` stay as backend-internal endpoints called by the agent loop's `apply_panel` tool; they are no longer hit directly by the frontend.

## Tool definitions (Anthropic schemas)

Each lives in `backend/app/agent/tools/<name>.py` with an Anthropic JSON schema + a Python handler. Brief shapes:

```python
# 1. analyze_image
{
  "name": "analyze_image",
  "description": "Analyse the current image and return a structured scene context including subjects, lighting, dominant tones, and labeled candidate regions.",
  "input_schema": {"type": "object", "properties": {}, "required": []}
}
# Output: ImageContext (existing shape).

# 2. segment_at_point  (BROWSER tool)
{
  "name": "segment_at_point",
  "description": "Run SAM in the browser at the given image-pixel coordinates. Returns a maskRef usable in scope or as a target.",
  "input_schema": {"type": "object",
    "properties": {
      "x": {"type": "number"},
      "y": {"type": "number"},
      "layer_id": {"type": "string"}
    },
    "required": ["x","y","layer_id"]}
}
# Output: { maskRef: string }.

# 3. segment_by_label
{
  "name": "segment_by_label",
  "description": "Look up the representative point of a labelled region from analyze_image's candidateRegions, then segment at that point.",
  "input_schema": {"type": "object",
    "properties": {"label": {"type": "string"}, "layer_id": {"type": "string"}},
    "required": ["label","layer_id"]}
}
# Output: { maskRef, label }.

# 4. apply_panel
{
  "name": "apply_panel",
  "description": "Generate an OperationGraph for the given goal and target. The graph's adjustments are added to the target's layer with scope inferred from target.",
  "input_schema": {"type": "object",
    "properties": {
      "target_ref": {"$ref": "#/defs/TargetRef"},
      "goal": {"type": "string"}
    },
    "required": ["target_ref","goal"]}
}
# Output: { graphId, summary }.

# 5. extract_to_layer
{ "name": "extract_to_layer",
  "description": "Create a new layer that is a non-destructive branch of the source layer, masked by the given maskRef.",
  "input_schema": {"type": "object",
    "properties": {"source_layer_id": {"type": "string"}, "mask_ref": {"type": "string"}, "name": {"type":"string"}},
    "required": ["source_layer_id","mask_ref"]} }
# Output: { layerId }.

# 6. remove_region
{ "name": "remove_region",
  "description": "Inpaint the masked region of the source layer via Replicate. Result becomes a new layer above source.",
  "input_schema": {"type": "object",
    "properties": {"source_layer_id": {"type":"string"}, "mask_ref": {"type":"string"}, "prompt": {"type":"string"}},
    "required": ["source_layer_id","mask_ref"]} }
# Output: { layerId }.

# 7. get_layers
{ "name": "get_layers",
  "description": "Return the current layer inventory including parent/mask relationships.",
  "input_schema": {"type":"object","properties":{},"required":[]} }
# Output: LayerInventory.

# 8. add_adjustment
{ "name": "add_adjustment",
  "description": "Add a single adjustment of the given type with params to the specified layer's chain.",
  "input_schema": {"type":"object",
    "properties":{
      "layer_id": {"type":"string"},
      "type": {"type":"string","enum":["light","color","kelvin","curves","levels","filter"]},
      "params": {"type":"object"},
      "scope": {"$ref":"#/defs/Scope"}
    },
    "required":["layer_id","type","params"]} }
# Output: { adjustmentId }.
```

## Component touchpoints

| Path | Action | Purpose |
|---|---|---|
| `src/core/mask-store.ts` | create | First-class Mask data store |
| `src/types/scope.ts` | create | Typed Scope discriminated union |
| `src/store/segmentation-slice.ts` | create | Active / committed mask + encoder state |
| `src/store/layer-slice.ts` | modify | Add `parentLayerId`, `layerMask`; extend Adjustment with `scope` |
| `src/store/segment-actions.ts` | create | `extractLayerFromMask`, `inpaintAndAddLayer` |
| `src/lib/sam/model-loader.ts` | create | Lazy ONNX model fetch + IDB cache |
| `src/lib/sam/sam-client.ts` | create | Facade for embedding + segmentation |
| `src/workers/sam.worker.ts` | create | Comlink worker wrapping ONNX sessions |
| `src/tools/select-point-tool.ts` | create | Single-point selection |
| `src/tools/select-multi-point-tool.ts` | create | Multi-point with +/- modifiers |
| `src/tools/select-box-tool.ts` | create | Box prompt |
| `src/tools/brush-mask-tool.tsx` | create | Brush into mask alpha |
| `src/components/canvas/MaskOverlay.tsx` | create | Live mask + marching-ants rendering |
| `src/components/canvas/SegmentActionsBar.tsx` | create | Floating action bar |
| `src/lib/pipeline-manager.ts` | modify | `u_maskTex`/`u_useMask` shader binding |
| `src/lib/layer-compositor.ts` | modify | Honour `parentLayerId` + `layerMask` |
| `src/shaders/*.ts` | modify | Append `applyMask` snippet |
| `src/core/derived-graph.ts` | modify | Branch edges for layers with children |
| `src/lib/agent-client.ts` | create | SSE-driven agent client |
| `src/lib/ai-client.ts` | modify | Add `inpaintRegion`; deprecate direct `generatePanel`/`refinePanel` callers |
| `src/types/ai-target.ts` | modify | Add `{ kind: 'mask'; maskRef }` variant |
| `src/lib/target-ref.ts` | modify | `humanLabelFor` and `renderTargetSnapshot` cases for mask targets |
| `src/components/AiCommandPalette.tsx` | modify | Chip + preview handle mask targets |
| `src/App.tsx` | modify | Cmd+K calls `runAgent` instead of `generatePanel` |
| `backend/app/api/inpaint.py` | create | Replicate-backed inpainting endpoint |
| `backend/app/api/agent.py` | create | SSE agent loop |
| `backend/app/agent/tools/*.py` | create | Per-tool definitions + handlers |
| `backend/app/services/replicate_client.py` | create | Replicate SDK wrapper |
| `backend/app/config.py` | modify | Add `REPLICATE_API_TOKEN` setting |

## Out of scope (deferred)

- **Pressure-sensitive brush-into-mask with soft edges** — v1 ships hard-alpha paint
- **Reverse-prompt SAM (text → mask via grounding model like Grounding DINO)** — `segment_by_label` uses analyze regions, not direct text grounding
- **Multi-mask per layer** — one `layerMask` per layer; multiple region scopes within one layer go on individual adjustments
- **Mask animation / temporal scopes** — no concept of time-varying masks
- **Replicate model picker** — fixed model in v1
- **Real history-tree branching** — Phase 5 territory
- **Cascading layer removal** — removing a parent with children is blocked; user must remove children first
- **Mask refinement via brush stroke that updates SAM prompts** — brush writes directly to alpha; doesn't re-invoke SAM
- **Agent tool permission policy** — Claude has all 8 tools unconditionally; future work can add per-tool toggles or rate limits
- **Reverse the agent flow for arbitrary tasks** — only Cmd+K goes through `/api/agent`; other AI surfaces (refine) stay as direct endpoints

## Success criteria

1. SelectPointTool: open image → switch tool → click → mask appears within ~1.2 s on first invocation (cold model load), ~150 ms thereafter (warm decoder, cached embedding).
2. Commit mask → SegmentActionsBar appears with the five actions.
3. **Extract layer** → new layer appears in layers panel and in the graph editor as a branch off the source layer; rendering shows only the masked region.
4. **Remove** → Replicate call succeeds; new layer above source contains the inpainted result.
5. **Edit with AI** → palette opens with target chip = mask label; submitting a prompt produces an `ai-step` whose adjustments are scoped to the mask (visibly affects only the masked region).
6. **Scope** → bar enters scoped state; adding a new Curves adjustment from the toolbar gives that adjustment `scope: { kind:'mask', maskRef }` automatically.
7. **Agent end-to-end**: Cmd+K "darken the sky" (no manual selection) → backend Claude calls `analyze_image` → `segment_by_label("sky")` → `apply_panel(maskRef, "darken")`; user sees side-effects stream in via SSE; the resulting `ai-step` is scoped to the sky mask.
8. `.edp` round-trip: opening a saved file restores masks, `parentLayerId` relationships, and adjustment scopes.
9. `npm run check` + backend tests pass.

## Risks

| Risk | Mitigation |
|---|---|
| ONNX Web ViT-B inference slower than 1 s on target hardware | Day-1 spike. Fall back to backend-hosted SAM (revisit Q2) if needed. |
| 100 MB model download on first use feels broken | Show explicit progress in tool options panel; cache aggressively in IDB. |
| Replicate latency / cost during evaluation | Add per-session inpainting call budget; cache results by `(layerId, maskRef)` hash. |
| SSE not surviving proxy / browser tabs | Use `fetch-event-source` (POST + reconnect). Test in dev + Safari early. |
| Agent loop infinite recursion (Claude keeps calling tools) | Hard cap at 12 tool-use rounds per request; return error to user with whatever side-effects accumulated. |
| Mask resolution mismatch with image after crop | Apply masks in *source* coordinates; render through crop transform at composite time. |
| `add_adjustment` lets Claude do something stupid | Acceptable for thesis. Future: per-tool guardrails. |
