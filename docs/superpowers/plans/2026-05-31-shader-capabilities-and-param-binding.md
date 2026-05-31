# Shader Capabilities & Param-Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind AI-proposed tonal params (whites/blacks) to the WebGL pipeline, guard the param contract in CI, fix AI-suggestion live preview, and add HSL / sharpen / blur / clarity ops.

**Architecture:** The editor has a shared param contract ([shared/engine-registry.json](../../../shared/engine-registry.json)) imported by both the frontend shader pipeline and the Python backend. Adding a capability = shader + pipeline registration + registry entry + `ProcessingDefinition`. Point ops are single-pass; the new convolution ops (sharpen/blur/clarity) require one contained pipeline extension (a `u_texel` uniform + an optional multi-pass `renderInto` hook).

**Tech Stack:** React 19 + TypeScript (Vitest), WebGL2 GLSL ES 3.00 shaders, Zustand+Immer store, Python FastAPI backend (pytest).

**Spec:** [docs/superpowers/specs/2026-05-31-shader-capabilities-and-param-binding-design.md](../specs/2026-05-31-shader-capabilities-and-param-binding-design.md)

**Conventions:** Commit messages use Conventional Commits, no AI/co-author trailer. Run `npm run check` (tsc + eslint + vitest) for frontend; `cd backend && pytest` for backend. Shader rendering can't run in jsdom/vitest, so shader-only tasks are verified via `npm run check` + the browser preview (load an image, drag the slider).

---

## File Structure

**Created:**
- `backend/tests/tools/test_fused_params_in_registry.py` — contract guard.
- `src/shaders/color-space.glsl.ts` — shared GLSL `rgb2hsl`/`hsl2rgb` snippet.
- `src/shaders/hsl.glsl.ts`, `src/shaders/sharpen.glsl.ts`, `src/shaders/blur.glsl.ts`, `src/shaders/clarity.glsl.ts` — new shaders.
- `src/processing/hsl.tsx`, `src/processing/sharpen.tsx`, `src/processing/blur.tsx`, `src/processing/clarity.tsx` — `ProcessingDefinition`s.
- `src/components/inspector/adjustments/HslSectionBody.tsx` — 8-band HSL grid.

**Modified:**
- `shared/engine-registry.json` — `light` +whites/blacks; new `hsl`/`sharpen`/`blur`/`clarity` ops.
- `src/shaders/basic-adjustments.glsl.ts` — whites/blacks uniforms + math; use shared color-space snippet.
- `src/shaders/pipeline.ts` — set new uniforms; register new shaders; `u_texel` + multi-pass.
- `src/processing/light.tsx` — whites/blacks sliders.
- `src/processing/index.ts` — register the four new ops.
- `src/components/inspector/adjustments/ToolSection.tsx` — `hsl` body branch.
- `src/components/inspector/adjustments/AiSection.tsx` — re-key optimistic to canonical node id.
- `src/store/backend-state-slice.ts` — `applyOptimistic` merges per node.

---

## Phase 0 — whites/blacks binding

### Task 1: Contract guard (drives the registry fix)

**Files:**
- Test: `backend/tests/tools/test_fused_params_in_registry.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/tools/test_fused_params_in_registry.py
"""Every param key a fused tool writes onto a node must exist in the shared
engine registry for that node's shader binding — otherwise the WebGL pipeline
silently drops it (no uniform to receive it)."""
from app.engine.registry import ENGINE_OPS
from app.tools.fused import all_fused_templates

# Node types that are texture/structured shaders (no scalar param contract).
STRUCTURED_NODE_TYPES = {"curves", "lut"}

# Pre-existing, tracked gaps. Each entry is debt to fix separately, NOT a licence
# to add more. Do not extend without a tracking note.
KNOWN_UNBOUND = {
    # Fused kelvin nodes write 'temperature'; the kelvin op/shader read 'kelvin'.
    # TODO(kelvin-temp): rename to 'kelvin' in the kelvin fused templates.
    ("kelvin", "temperature"),
}


def _binding_to_params() -> dict[str, set[str]]:
    """shaderBinding -> union of scalar param keys across ops that bind to it."""
    out: dict[str, set[str]] = {}
    for op in ENGINE_OPS.values():
        out.setdefault(op["shaderBinding"], set()).update(op["params"].keys())
    return out


def test_every_fused_node_param_is_in_the_registry():
    binding_params = _binding_to_params()
    violations: list[str] = []
    for template in all_fused_templates():
        for nd in template.node_skeleton:
            node_type = nd.node_type
            keys = set(nd.tunable_param_keys) | set(nd.fixed_params.keys())
            for key in keys:
                if node_type in STRUCTURED_NODE_TYPES:
                    continue
                if (node_type, key) in KNOWN_UNBOUND:
                    continue
                if key not in binding_params.get(node_type, set()):
                    violations.append(f"{template.id}: ({node_type}, {key})")
    assert not violations, "fused params with no shader uniform: " + ", ".join(violations)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tools/test_fused_params_in_registry.py -v`
Expected: FAIL — violations listing `exposure_balance: (basic, whites)`, `(basic, blacks)`, `sky_recovery: (basic, whites)`.

- [ ] **Step 3: Add whites/blacks to the registry**

In [shared/engine-registry.json](../../../shared/engine-registry.json), inside `ops.light.params`, after the `shadows` entry add:

```json
        "whites":     { "uniform": "u_whites",     "label": "Whites",     "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "blacks":     { "uniform": "u_blacks",     "label": "Blacks",     "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
```

(Place them before `brightness` so JSON stays valid; ensure the preceding line keeps its trailing comma.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/tools/test_fused_params_in_registry.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/tools/test_fused_params_in_registry.py shared/engine-registry.json
git commit -m "feat(engine): bind whites/blacks in the param registry + add fused-param contract test"
```

### Task 2: whites/blacks shader uniforms + tone math

**Files:**
- Modify: `src/shaders/basic-adjustments.glsl.ts`
- Modify: `src/shaders/pipeline.ts:130-144` (basic `setUniforms`) and `:372-389` (passthrough block)

- [ ] **Step 1: Add the uniforms + math to the shader**

In [basic-adjustments.glsl.ts](../../../src/shaders/basic-adjustments.glsl.ts), after `uniform float u_shadows;` add:

```glsl
uniform float u_whites;      // -1 to 1
uniform float u_blacks;      // -1 to 1
```

Then in `main()`, immediately after the existing shadows line (`color += u_shadows * shadowMask * 0.5;`) add:

```glsl
  // Whites & Blacks — act on the tonal extremes (vs highlights/shadows midtones)
  float whitesMask = smoothstep(0.6, 1.0, lum);
  color += u_whites * whitesMask * 0.5;
  float blacksMask = 1.0 - smoothstep(0.0, 0.4, lum);
  color += u_blacks * blacksMask * 0.5;
```

- [ ] **Step 2: Set the uniforms in the basic pass**

In [pipeline.ts](../../../src/shaders/pipeline.ts) `initShaders`, in the `basic` shader's `setUniforms`, after the `u_shadows` line add:

```javascript
        gl.uniform1f(gl.getUniformLocation(program, 'u_whites'), engineUniformValue('whites', (p.whites as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_blacks'), engineUniformValue('blacks', (p.blacks as number) ?? 0));
```

- [ ] **Step 3: Add neutral defaults to the passthrough block**

In `drawPass`'s passthrough branch (the `else` that binds the basic program with neutral params), after the `u_shadows` neutral line add:

```javascript
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_whites'), 0);
      gl.uniform1f(gl.getUniformLocation(basic.program, 'u_blacks'), 0);
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run check`
Expected: PASS (tsc + eslint + 305 existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/shaders/basic-adjustments.glsl.ts src/shaders/pipeline.ts
git commit -m "feat(shader): apply whites/blacks tonal adjustments in the basic shader"
```

### Task 3: whites/blacks in the Light panel

**Files:**
- Modify: `src/processing/light.tsx`

- [ ] **Step 1: Add params to the ProcessingDefinition**

In [light.tsx](../../../src/processing/light.tsx), set `paramKeys` and `params` to include whites/blacks:

```javascript
  paramKeys: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  params: [
    { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
    { key: 'brightness', label: 'Brightness', min: -100, max: 100, default: 0 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
    { key: 'highlights', label: 'Highlights', min: -100, max: 100, default: 0 },
    { key: 'shadows', label: 'Shadows', min: -100, max: 100, default: 0 },
    { key: 'whites', label: 'Whites', min: -100, max: 100, default: 0 },
    { key: 'blacks', label: 'Blacks', min: -100, max: 100, default: 0 },
  ],
```

- [ ] **Step 2: Add the sliders to LightPanel**

In `LightPanel`, add the hooks after `shadows`:

```javascript
  const [whites, setWhites] = useProcessingParam(layerId, 'basic', adjustmentId, 'whites', 0);
  const [blacks, setBlacks] = useProcessingParam(layerId, 'basic', adjustmentId, 'blacks', 0);
```

Update `isDefault` to `… && shadows === 0 && whites === 0 && blacks === 0`, add `setWhites(0); setBlacks(0);` to `reset`, and add after the Shadows `<AdjustmentSlider>`:

```jsx
      <AdjustmentSlider label="Whites" value={whites} min={-100} max={100} defaultValue={0} onChange={setWhites} />
      <AdjustmentSlider label="Blacks" value={blacks} min={-100} max={100} defaultValue={0} onChange={setBlacks} />
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/processing/light.tsx
git commit -m "feat(light): expose Whites/Blacks sliders in the Light panel"
```

---

## Phase 1 — live-preview fix

### Task 4: applyOptimistic merges per node

**Files:**
- Modify: `src/store/backend-state-slice.ts:257-260`
- Test: `src/store/backend-state-slice.test.ts`

- [ ] **Step 1: Write the failing test**

Append to [backend-state-slice.test.ts](../../../src/store/backend-state-slice.test.ts):

```typescript
it('applyOptimistic merges bindings on the same node by paramKey', () => {
  const s = useBackendState.getState();
  s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 40 }], baseRevision: 1 });
  s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'shadows', value: -20 }], baseRevision: 1 });
  const patch = useBackendState.getState().optimistic.get('canon:L1:basic');
  const byKey = Object.fromEntries((patch?.bindings ?? []).map((b) => [b.paramKey, b.value]));
  expect(byKey).toEqual({ highlights: 40, shadows: -20 });
});

it('applyOptimistic overwrites the same paramKey rather than duplicating', () => {
  const s = useBackendState.getState();
  s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 40 }], baseRevision: 1 });
  s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 10 }], baseRevision: 1 });
  const patch = useBackendState.getState().optimistic.get('canon:L1:basic');
  expect(patch?.bindings).toEqual([{ paramKey: 'highlights', value: 10 }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/backend-state-slice.test.ts -t "applyOptimistic merges"`
Expected: FAIL — second binding replaces the first (only `shadows` present).

- [ ] **Step 3: Implement the merge**

Replace `applyOptimistic` in [backend-state-slice.ts](../../../src/store/backend-state-slice.ts):

```typescript
    applyOptimistic: (widgetId, patch) =>
      set((s) => {
        const existing = s.optimistic.get(widgetId);
        if (!existing || existing.baseRevision !== patch.baseRevision) {
          s.optimistic.set(widgetId, patch);
          return;
        }
        const byKey = new Map(existing.bindings.map((b) => [b.paramKey, b]));
        for (const b of patch.bindings) byKey.set(b.paramKey, b);
        s.optimistic.set(widgetId, { baseRevision: patch.baseRevision, bindings: [...byKey.values()] });
      }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/store/backend-state-slice.test.ts`
Expected: PASS (all, including the 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/store/backend-state-slice.ts src/store/backend-state-slice.test.ts
git commit -m "fix(store): merge optimistic patches per node so sibling params don't clobber"
```

### Task 5: AiSection re-keys optimistic to the canonical node

**Files:**
- Modify: `src/components/inspector/adjustments/AiSection.tsx`
- Test: `src/components/inspector/adjustments/AiSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to [AiSection.test.tsx](../../../src/components/inspector/adjustments/AiSection.test.tsx). Use a **real** autonomous-widget node id (`n_basic`) that differs from its canonical id (`canon:L1:basic`), so the test goes red on the old code. The `beforeEach` already expands section `'w1'`, so reuse that id:

```typescript
it('keys AI-suggestion optimistic preview on the canonical node id, not the widget node id', () => {
  const w = {
    id: 'w1', intent: 'Recover', status: 'active',
    origin: { kind: 'mcp_autonomous' }, scope: { root: { kind: 'global' } },
    nodes: [{ id: 'n_basic', type: 'basic', layer_id: 'L1', params: { highlights: 0 } }],
    bindings: [{
      param_key: 'highlights', label: 'Highlights', control_type: 'slider',
      control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 },
      target: { node_id: 'n_basic', param_key: 'highlights' },
      value: 0, default: 0,
    }],
    preview: { kind: 'none' },
  } as unknown as Widget;
  useBackendState.setState({ snapshot: { ...useBackendState.getState().snapshot!, widgets: [w] } } as never);
  render(<AiSection widget={w} />);
  // Radix slider thumb (role="slider") responds to keyboard; ArrowRight nudges by step.
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
  const opt = useBackendState.getState().optimistic;
  expect(opt.has('canon:L1:basic')).toBe(true);
  expect(opt.has('n_basic')).toBe(false);
});
```

> Fallback if the Radix keyboard event doesn't fire `onValueChange` under jsdom: drive the
> click-to-edit readout instead —
> `const r = screen.getByTitle('Drag to scrub · click to type'); fireEvent.pointerDown(r, { clientX: 0 }); fireEvent.pointerUp(r, { clientX: 0 }); fireEvent.change(screen.getByRole('textbox'), { target: { value: '40' } }); fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });`

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/inspector/adjustments/AiSection.test.tsx -t "canonical node id"`
Expected: FAIL — old code keys optimistic on `n_basic`, so `opt.has('canon:L1:basic')` is false.

- [ ] **Step 3: Derive the canonical id in setParam and effectiveOf**

In [AiSection.tsx](../../../src/components/inspector/adjustments/AiSection.tsx), add a helper near the top of the component body:

```typescript
  function canonIdFor(b: ControlBinding): string | null {
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    if (!node) return null;
    return `canon:${node.layer_id}:${node.type}`;
  }
```

In `effectiveOf`, read optimistic from the canonical id + the node param key:

```typescript
  function effectiveOf(b: ControlBinding): ControlValue {
    const canonId = canonIdFor(b);
    const patch = canonId ? optimistic.get(canonId) : undefined;
    const opt = patch?.bindings.find((p) => p.paramKey === b.target.param_key)?.value;
    return opt !== undefined ? opt : b.value;
  }
```

In `setParam`, apply optimistic to the canonical id with the node param key:

```typescript
  function setParam(b: ControlBinding, value: ControlValue) {
    if (!canWrite() || !sessionId) return;
    const node = widget.nodes.find((n) => n.id === b.target.node_id);
    const canonId = node ? `canon:${node.layer_id}:${node.type}` : b.target.node_id;
    const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
    useBackendState.getState().applyOptimistic(canonId, {
      bindings: [{ paramKey: b.target.param_key, value }],
      baseRevision,
    });
    if (node?.layer_id) {
      useEditorStore.getState().markParamTouched(touchKey(node.layer_id, node.type, b.target.param_key));
    }
    void backendTools.set_widget_param(sessionId, { widget_id: widget.id, param_key: b.param_key, value });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/inspector/adjustments/AiSection.test.tsx`
Expected: PASS (all, including prior arrow test).

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/adjustments/AiSection.tsx src/components/inspector/adjustments/AiSection.test.tsx
git commit -m "fix(ai): key AI-suggestion optimistic preview on the canonical node so drags update the canvas live"
```

---

## Phase 2 — HSL (8-band targeted colour)

### Task 6: Extract shared color-space GLSL snippet

**Files:**
- Create: `src/shaders/color-space.glsl.ts`
- Modify: `src/shaders/basic-adjustments.glsl.ts`

- [ ] **Step 1: Create the snippet**

```typescript
// src/shaders/color-space.glsl.ts
/** Shared RGB↔HSL helpers (GLSL ES 3.00). Included verbatim into shaders that
 *  need per-pixel hue/sat/lum manipulation (basic adjustments, HSL). */
export const colorSpaceSnippet = /* glsl */`
vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  float h = 0.0;
  if (maxC != minC) {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}
`;
```

- [ ] **Step 2: Use it in basic-adjustments (no behavior change)**

In [basic-adjustments.glsl.ts](../../../src/shaders/basic-adjustments.glsl.ts): add `import { colorSpaceSnippet } from './color-space.glsl';` at the top, **delete** the inline `rgb2hsl`, `hue2rgb`, `hsl2rgb` function definitions, and inject the snippet after the mask snippet:

```typescript
export const basicAdjustmentsFragment = `#version 300 es
precision highp float;
${maskSnippet}
${colorSpaceSnippet}
in vec2 v_texCoord;
out vec4 fragColor;
...
```

- [ ] **Step 3: Verify no behavioral change**

Run: `npm run check`
Expected: PASS. (Then in the preview, confirm Light/Color hue still works — Task is structural.)

- [ ] **Step 4: Commit**

```bash
git add src/shaders/color-space.glsl.ts src/shaders/basic-adjustments.glsl.ts
git commit -m "refactor(shader): extract shared rgb2hsl/hsl2rgb into color-space snippet"
```

### Task 7: HSL registry op (24 params)

**Files:**
- Modify: `shared/engine-registry.json`
- Test: `backend/tests/tools/test_fused_params_in_registry.py` (already passing; this keeps it green)

- [ ] **Step 1: Add the `hsl` op**

In [engine-registry.json](../../../shared/engine-registry.json), add a new op after `levels` (mind the comma after the `levels` block's closing brace). Bands are red, orange, yellow, green, aqua, blue, purple, magenta → indices 0–7. For each band `B` at index `i`, add three params `B_hue`/`B_sat`/`B_lum` with uniforms `u_hslHue[i]`/`u_hslSat[i]`/`u_hslLum[i]`:

```json
    "hsl": {
      "shaderBinding": "hsl",
      "toolDefaults": [],
      "params": {
        "red_hue":     { "uniform": "u_hslHue[0]", "label": "Red Hue",     "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "red_sat":     { "uniform": "u_hslSat[0]", "label": "Red Sat",     "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "red_lum":     { "uniform": "u_hslLum[0]", "label": "Red Lum",     "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "orange_hue":  { "uniform": "u_hslHue[1]", "label": "Orange Hue",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "orange_sat":  { "uniform": "u_hslSat[1]", "label": "Orange Sat",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "orange_lum":  { "uniform": "u_hslLum[1]", "label": "Orange Lum",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "yellow_hue":  { "uniform": "u_hslHue[2]", "label": "Yellow Hue",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "yellow_sat":  { "uniform": "u_hslSat[2]", "label": "Yellow Sat",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "yellow_lum":  { "uniform": "u_hslLum[2]", "label": "Yellow Lum",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "green_hue":   { "uniform": "u_hslHue[3]", "label": "Green Hue",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "green_sat":   { "uniform": "u_hslSat[3]", "label": "Green Sat",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "green_lum":   { "uniform": "u_hslLum[3]", "label": "Green Lum",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "aqua_hue":    { "uniform": "u_hslHue[4]", "label": "Aqua Hue",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "aqua_sat":    { "uniform": "u_hslSat[4]", "label": "Aqua Sat",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "aqua_lum":    { "uniform": "u_hslLum[4]", "label": "Aqua Lum",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "blue_hue":    { "uniform": "u_hslHue[5]", "label": "Blue Hue",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "blue_sat":    { "uniform": "u_hslSat[5]", "label": "Blue Sat",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "blue_lum":    { "uniform": "u_hslLum[5]", "label": "Blue Lum",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "purple_hue":  { "uniform": "u_hslHue[6]", "label": "Purple Hue",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "purple_sat":  { "uniform": "u_hslSat[6]", "label": "Purple Sat",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "purple_lum":  { "uniform": "u_hslLum[6]", "label": "Purple Lum",  "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "magenta_hue": { "uniform": "u_hslHue[7]", "label": "Magenta Hue", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "magenta_sat": { "uniform": "u_hslSat[7]", "label": "Magenta Sat", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "magenta_lum": { "uniform": "u_hslLum[7]", "label": "Magenta Lum", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 }
      }
    }
```

- [ ] **Step 2: Verify the registry parses and the contract test still passes**

Run: `cd backend && pytest tests/tools/test_fused_params_in_registry.py -v`
Expected: PASS (no fused tool references hsl yet; the op just registers params).

- [ ] **Step 3: Commit**

```bash
git add shared/engine-registry.json
git commit -m "feat(engine): register 8-band HSL op (24 contract-checked params)"
```

### Task 8: HSL shader

**Files:**
- Create: `src/shaders/hsl.glsl.ts`

- [ ] **Step 1: Write the shader**

```typescript
// src/shaders/hsl.glsl.ts
import { maskSnippet } from './mask-snippet.glsl';
import { colorSpaceSnippet } from './color-space.glsl';

/** 8-band targeted HSL. Each band has a hue-rotation, saturation-scale, and
 *  luminance-shift, weighted by the pixel's circular hue distance to the band
 *  centre. Uniform arrays are addressed per-band from the pipeline. */
export const hslFragment = `#version 300 es
precision highp float;
${maskSnippet}
${colorSpaceSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_hslHue[8];   // each -1..1
uniform float u_hslSat[8];   // each -1..1
uniform float u_hslLum[8];   // each -1..1

// Band centres in normalized hue [0,1): red, orange, yellow, green, aqua, blue, purple, magenta
const float CENTERS[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.8333);

float bandWeight(float h, float center) {
  float d = abs(h - center);
  d = min(d, 1.0 - d);          // circular distance
  return max(0.0, 1.0 - d / 0.0833);  // triangular falloff, ~30deg half-width
}

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 hsl = rgb2hsl(clamp(texel.rgb, 0.0, 1.0));

  float hueShift = 0.0, satScale = 0.0, lumShift = 0.0, wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(hsl.x, CENTERS[i]);
    hueShift += w * u_hslHue[i];
    satScale += w * u_hslSat[i];
    lumShift += w * u_hslLum[i];
    wsum += w;
  }
  if (wsum > 0.0) { hueShift /= wsum; satScale /= wsum; lumShift /= wsum; }

  hsl.x = fract(hsl.x + hueShift * 0.0833);          // max ~±30deg
  hsl.y = clamp(hsl.y * (1.0 + satScale), 0.0, 1.0);  // ±100%
  hsl.z = clamp(hsl.z + lumShift * 0.25, 0.0, 1.0);   // ±0.25 lightness

  vec3 rgb = hsl2rgb(hsl);
  vec4 adjusted = vec4(clamp(rgb, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
```

- [ ] **Step 2: Verify it imports/compiles (TS)**

Run: `npm run check`
Expected: PASS (shader is a string; GL compile is exercised at runtime in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/shaders/hsl.glsl.ts
git commit -m "feat(shader): add 8-band HSL fragment shader"
```

### Task 9: Register HSL in the pipeline

**Files:**
- Modify: `src/shaders/pipeline.ts`

- [ ] **Step 1: Import the shader**

Add near the other shader imports: `import { hslFragment } from './hsl.glsl.ts';`

- [ ] **Step 2: Register the program + uniforms**

In `initShaders`, after the `basic` registration, add:

```javascript
    // HSL targeted colour
    const hslProgram = createProgram(gl, fullscreenQuadVertex, hslFragment);
    const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
    this.shaders.set('hsl', {
      program: hslProgram,
      setUniforms: (gl, program, adj) => {
        const p = adj.params;
        HSL_BANDS.forEach((band, i) => {
          gl.uniform1f(gl.getUniformLocation(program, `u_hslHue[${i}]`), engineUniformValue(`${band}_hue`, (p[`${band}_hue`] as number) ?? 0));
          gl.uniform1f(gl.getUniformLocation(program, `u_hslSat[${i}]`), engineUniformValue(`${band}_sat`, (p[`${band}_sat`] as number) ?? 0));
          gl.uniform1f(gl.getUniformLocation(program, `u_hslLum[${i}]`), engineUniformValue(`${band}_lum`, (p[`${band}_lum`] as number) ?? 0));
        });
      },
    });
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shaders/pipeline.ts
git commit -m "feat(pipeline): register the HSL shader pass with per-band uniforms"
```

### Task 10: HSL panel + processing definition

**Files:**
- Create: `src/components/inspector/adjustments/HslSectionBody.tsx`
- Create: `src/processing/hsl.tsx`
- Modify: `src/components/inspector/adjustments/ToolSection.tsx`
- Modify: `src/processing/index.ts`

- [ ] **Step 1: Create the HSL grid body**

```tsx
// src/components/inspector/adjustments/HslSectionBody.tsx
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';

const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
const CHANNELS = [
  { key: 'hue', label: 'Hue' },
  { key: 'sat', label: 'Sat' },
  { key: 'lum', label: 'Lum' },
] as const;

interface BandRowProps { layerId: string; band: string; }

function BandRow({ layerId, band }: BandRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] capitalize text-text-secondary">{band}</span>
      {CHANNELS.map((c) => <HslParam key={c.key} layerId={layerId} band={band} channel={c.key} label={c.label} />)}
    </div>
  );
}

interface HslParamProps { layerId: string; band: string; channel: string; label: string; }

function HslParam({ layerId, band, channel, label }: HslParamProps) {
  const [value, setValue] = useCanonicalParam<number>(layerId, 'hsl', `${band}_${channel}`, 0);
  return (
    <AdjustmentSlider label={label} value={value} min={-100} max={100} defaultValue={0} onChange={setValue} />
  );
}

export function HslSectionBody({ layerId }: { layerId: string }) {
  return (
    <div className="flex flex-col gap-3 px-2.5 py-2">
      {BANDS.map((b) => <BandRow key={b} layerId={layerId} band={b} />)}
    </div>
  );
}
```

- [ ] **Step 2: Create the processing definition**

```tsx
// src/processing/hsl.tsx
import { Palette } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { HslSectionBody } from '@/components/inspector/adjustments/HslSectionBody';

function HslPanel({ layerId }: ProcessingPanelProps) {
  return <HslSectionBody layerId={layerId} />;
}

const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const CHANNELS = ['hue', 'sat', 'lum'];

export const hslProcessing: ProcessingDefinition = {
  id: 'hsl',
  label: 'HSL',
  icon: Palette,
  category: 'adjust',
  adjustmentType: 'hsl',
  paramKeys: BANDS.flatMap((b) => CHANNELS.map((c) => `${b}_${c}`)),
  params: BANDS.flatMap((b) =>
    CHANNELS.map((c) => ({ key: `${b}_${c}`, label: `${b} ${c}`, min: -100, max: 100, default: 0 })),
  ),
  Panel: HslPanel,
};
```

- [ ] **Step 3: Branch ToolSection to the HSL body**

In [ToolSection.tsx](../../../src/components/inspector/adjustments/ToolSection.tsx), add the import `import { HslSectionBody } from './HslSectionBody';` and add a branch in the expanded body before the `else`:

```jsx
      {expanded && layerId && (
        def.adjustmentType === 'curves' ? (
          <CurvesSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'hsl' ? (
          <HslSectionBody layerId={layerId} />
        ) : def.adjustmentType === 'lut' ? (
          <PromoteOnlyBody toolId={def.id} />
        ) : (
          <ScalarSectionBody layerId={layerId} op={def.adjustmentType} params={def.params} />
        )
      )}
```

- [ ] **Step 4: Register it**

In [processing/index.ts](../../../src/processing/index.ts), import `hslProcessing` and add `ProcessingRegistry.register(hslProcessing);` (after `colorProcessing`), and add `hslProcessing` to the re-export block.

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/processing/hsl.tsx src/components/inspector/adjustments/HslSectionBody.tsx src/components/inspector/adjustments/ToolSection.tsx src/processing/index.ts
git commit -m "feat(hsl): add HSL processing definition + 8-band panel"
```

- [ ] **Step 7: Manual verification (preview)**

Start the preview, load an image, open the HSL accordion section, drag e.g. "blue lum" — the sky/blues should darken. Confirm no console errors.

---

## Phase 3 — convolution pass extension + sharpen

### Task 11: texelSize uniform + multi-pass pipeline hook + fboD

**Files:**
- Modify: `src/shaders/pipeline.ts`

- [ ] **Step 1: Add fboD and a texel field**

In the class fields, after `private fboC: FBO;` add `private fboD: FBO;`. In the constructor, after `this.fboC = this.createFBO(1, 1);` add `this.fboD = this.createFBO(1, 1);`. In `resizeFBOs`, mirror fboC for fboD (delete + recreate). In `dispose`, add `this.deleteFBO(this.fboD);`.

- [ ] **Step 2: Extend the ShaderPass interface**

Replace the `ShaderPass` interface with:

```typescript
interface ShaderPass {
  program: WebGLProgram;
  setUniforms: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => void;
  extraTextures?: (gl: WebGL2RenderingContext, program: WebGLProgram, adj: Adjustment) => WebGLTexture[];
  /** When true, drawPass sets u_texel = (1/width, 1/height) before drawing. */
  needsTexel?: boolean;
  /** Optional multi-pass override. When present the render loop calls this
   *  instead of a single drawPass; it must end by drawing into targetFramebuffer. */
  renderInto?: (ctx: RenderIntoCtx, adj: Adjustment) => void;
}

interface RenderIntoCtx {
  gl: WebGL2RenderingContext;
  inputTexture: WebGLTexture;
  targetFramebuffer: WebGLFramebuffer | null;
  scratchA: FBO;
  scratchB: FBO;
  width: number;
  height: number;
  texel: [number, number];
  drawQuad: () => void;
}
```

- [ ] **Step 3: Set u_texel in drawPass + provide a drawQuad helper**

In `drawPass`, right after `shader.setUniforms(...)`, add:

```javascript
      if (shader.needsTexel) {
        gl.uniform2f(gl.getUniformLocation(shader.program, 'u_texel'), 1 / this.width, 1 / this.height);
      }
```

Add a private helper:

```typescript
  private drawQuad(): void {
    const { gl } = this;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
```

- [ ] **Step 4: Call renderInto from the render loop**

In `render()`, in the `if (!needsBlend)` branch, replace the body with:

```javascript
        const target = isLast ? null : pingPong[ppIdx].framebuffer;
        if (shader.renderInto) {
          shader.renderInto({
            gl, inputTexture: currentTex, targetFramebuffer: target,
            scratchA: this.fboC, scratchB: this.fboD,
            width: this.width, height: this.height,
            texel: [1 / this.width, 1 / this.height],
            drawQuad: () => this.drawQuad(),
          }, adj);
        } else {
          const temps = this.drawPass(currentTex, target, shader, adj);
          for (const t of temps) gl.deleteTexture(t);
        }
        if (!isLast) {
          currentTex = pingPong[ppIdx].texture;
          ppIdx = 1 - ppIdx;
        }
```

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: PASS (no op uses the new hooks yet; existing rendering unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/shaders/pipeline.ts
git commit -m "feat(pipeline): add texelSize uniform + multi-pass renderInto hook + scratch FBO"
```

### Task 12: Sharpen op

**Files:**
- Create: `src/shaders/sharpen.glsl.ts`
- Create: `src/processing/sharpen.tsx`
- Modify: `shared/engine-registry.json`, `src/shaders/pipeline.ts`, `src/processing/index.ts`

- [ ] **Step 1: Shader**

```typescript
// src/shaders/sharpen.glsl.ts
import { maskSnippet } from './mask-snippet.glsl';

/** Single-pass unsharp via a 3x3 Laplacian. amount in 0..1 (registry-scaled). */
export const sharpenFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_amount;   // 0..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;
  vec3 sum = vec3(0.0);
  sum += texture(u_texture, v_texCoord + vec2(-u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2( u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0, -u_texel.y)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0,  u_texel.y)).rgb;
  vec3 laplacian = c * 4.0 - sum;          // high-frequency detail
  vec3 sharpened = c + laplacian * u_amount;
  vec4 adjusted = vec4(clamp(sharpened, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
```

- [ ] **Step 2: Registry op**

In [engine-registry.json](../../../shared/engine-registry.json), add after `hsl` (mind the comma):

```json
    "sharpen": {
      "shaderBinding": "sharpen",
      "toolDefaults": [],
      "params": {
        "amount": { "uniform": "u_amount", "label": "Amount", "min": 0, "max": 100, "step": 1, "scale": 100, "default": 0 }
      }
    }
```

- [ ] **Step 3: Register in the pipeline**

Add `import { sharpenFragment } from './sharpen.glsl.ts';`, then in `initShaders` after the hsl block:

```javascript
    // Sharpen (single-pass unsharp)
    const sharpenProgram = createProgram(gl, fullscreenQuadVertex, sharpenFragment);
    this.shaders.set('sharpen', {
      program: sharpenProgram,
      needsTexel: true,
      setUniforms: (gl, program, adj) => {
        gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), engineUniformValue('amount', (adj.params.amount as number) ?? 0));
      },
    });
```

- [ ] **Step 4: Processing definition**

```tsx
// src/processing/sharpen.tsx
import { Aperture } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function SharpenPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="sharpen" params={sharpenProcessing.params} />;
}

export const sharpenProcessing: ProcessingDefinition = {
  id: 'sharpen',
  label: 'Sharpen',
  icon: Aperture,
  category: 'adjust',
  adjustmentType: 'sharpen',
  paramKeys: ['amount'],
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 0 }],
  Panel: SharpenPanel,
};
```

Register in [processing/index.ts](../../../src/processing/index.ts) (import + `ProcessingRegistry.register(sharpenProcessing);` + re-export).

- [ ] **Step 5: Verify**

Run: `npm run check && (cd backend && pytest tests/tools/test_fused_params_in_registry.py -v)`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/sharpen.glsl.ts src/processing/sharpen.tsx shared/engine-registry.json src/shaders/pipeline.ts src/processing/index.ts
git commit -m "feat(sharpen): add single-pass unsharp sharpen op"
```

- [ ] **Step 7: Manual verification**

Preview: load an image, add Sharpen, raise Amount — edges should crisp up; no console errors.

---

## Phase 4 — blur + clarity

### Task 13: Gaussian blur (separable, multi-pass)

**Files:**
- Create: `src/shaders/blur.glsl.ts`
- Create: `src/processing/blur.tsx`
- Modify: `shared/engine-registry.json`, `src/shaders/pipeline.ts`, `src/processing/index.ts`

- [ ] **Step 1: Shader (one shader, direction-driven)**

```typescript
// src/shaders/blur.glsl.ts
import { maskSnippet } from './mask-snippet.glsl';

/** Separable Gaussian blur — run twice (horizontal then vertical) with a
 *  different u_direction. 9-tap fixed kernel scaled by u_radius. */
export const blurFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform vec2 u_direction;  // (1,0)*texel.x for H, (0,1)*texel.y for V
uniform float u_radius;    // 0..1 (registry-scaled)

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec2 step = u_direction * u_radius * 8.0;
  vec3 acc = texture(u_texture, v_texCoord).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = step * float(i);
    acc += texture(u_texture, v_texCoord + off).rgb * weights[i];
    acc += texture(u_texture, v_texCoord - off).rgb * weights[i];
  }
  vec4 adjusted = vec4(acc, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
```

- [ ] **Step 2: Registry op**

Add after `sharpen` (mind the comma):

```json
    "blur": {
      "shaderBinding": "blur",
      "toolDefaults": [],
      "params": {
        "radius": { "uniform": "u_radius", "label": "Radius", "min": 0, "max": 100, "step": 1, "scale": 100, "default": 0 }
      }
    }
```

- [ ] **Step 3: Register with a two-pass renderInto**

Add `import { blurFragment } from './blur.glsl.ts';`, then in `initShaders`:

```javascript
    // Gaussian blur (separable: H then V)
    const blurProgram = createProgram(gl, fullscreenQuadVertex, blurFragment);
    this.shaders.set('blur', {
      program: blurProgram,
      setUniforms: () => {},  // uniforms set inside renderInto per sub-pass
      renderInto: (ctx, adj) => {
        const { gl, inputTexture, targetFramebuffer, scratchA, texel, drawQuad } = ctx;
        const radius = engineUniformValue('radius', (adj.params.radius as number) ?? 0);
        const runPass = (inTex: WebGLTexture, outFb: WebGLFramebuffer | null, dir: [number, number]) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
          gl.viewport(0, 0, ctx.width, ctx.height);
          gl.useProgram(blurProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, inTex);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_texture'), 0);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_texel'), texel[0], texel[1]);
          gl.uniform2f(gl.getUniformLocation(blurProgram, 'u_direction'), dir[0], dir[1]);
          gl.uniform1f(gl.getUniformLocation(blurProgram, 'u_radius'), radius);
          gl.uniform1i(gl.getUniformLocation(blurProgram, 'u_useMask'), 0);
          drawQuad();
        };
        runPass(inputTexture, scratchA.framebuffer, [texel[0], 0]);  // horizontal → scratchA
        runPass(scratchA.texture, targetFramebuffer, [0, texel[1]]); // vertical → target
      },
    });
```

> Note: mask scoping for blur is intentionally disabled in v1 (`u_useMask = 0`); scoped blur arrives with the fused tools in Task 15.

- [ ] **Step 4: Processing definition**

```tsx
// src/processing/blur.tsx
import { Droplet } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function BlurPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="blur" params={blurProcessing.params} />;
}

export const blurProcessing: ProcessingDefinition = {
  id: 'blur',
  label: 'Blur',
  icon: Droplet,
  category: 'adjust',
  adjustmentType: 'blur',
  paramKeys: ['radius'],
  params: [{ key: 'radius', label: 'Radius', min: 0, max: 100, default: 0 }],
  Panel: BlurPanel,
};
```

Register in [processing/index.ts](../../../src/processing/index.ts).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/blur.glsl.ts src/processing/blur.tsx shared/engine-registry.json src/shaders/pipeline.ts src/processing/index.ts
git commit -m "feat(blur): add separable Gaussian blur via the multi-pass hook"
```

- [ ] **Step 7: Manual verification**

Preview: add Blur, raise Radius — image softens evenly (no directional streak, proving both passes run).

### Task 14: Clarity (local contrast)

**Files:**
- Create: `src/shaders/clarity.glsl.ts`
- Create: `src/processing/clarity.tsx`
- Modify: `shared/engine-registry.json`, `src/shaders/pipeline.ts`, `src/processing/index.ts`

- [ ] **Step 1: Shader (two-input combine)**

```typescript
// src/shaders/clarity.glsl.ts
import { maskSnippet } from './mask-snippet.glsl';

/** Clarity = large-radius unsharp. Combines the original with a blurred copy:
 *  out = original + amount * (original - blurred). */
export const clarityFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;   // original
uniform sampler2D u_blurred;   // blurred copy
uniform float u_amount;        // 0..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 blurred = texture(u_blurred, v_texCoord).rgb;
  vec3 detail = texel.rgb - blurred;
  vec3 result = texel.rgb + detail * u_amount;
  vec4 adjusted = vec4(clamp(result, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
```

- [ ] **Step 2: Registry op**

Add after `blur` (mind the comma):

```json
    "clarity": {
      "shaderBinding": "clarity",
      "toolDefaults": [],
      "params": {
        "amount": { "uniform": "u_amount", "label": "Amount", "min": 0, "max": 100, "step": 1, "scale": 100, "default": 0 }
      }
    }
```

> The `amount` key now exists in two ops (`sharpen`, `clarity`). `engineUniformValue` flattens param keys across ops, so they must share identical specs — they do (both `0..100`, `scale 100`). Keep them in sync.

- [ ] **Step 3: Register with a blur-then-combine renderInto**

Add `import { clarityFragment } from './clarity.glsl.ts';` and (reuse the blur program — capture it in a class field, or re-create). Add a class field `private blurProgram: WebGLProgram | null = null;` set during the blur registration (`this.blurProgram = blurProgram;`). Then register clarity:

```javascript
    // Clarity (large-radius unsharp = blur then combine)
    const clarityProgram = createProgram(gl, fullscreenQuadVertex, clarityFragment);
    this.shaders.set('clarity', {
      program: clarityProgram,
      setUniforms: () => {},
      renderInto: (ctx, adj) => {
        const { gl, inputTexture, targetFramebuffer, scratchA, scratchB, texel, drawQuad } = ctx;
        const amount = engineUniformValue('amount', (adj.params.amount as number) ?? 0);
        const blur = this.blurProgram!;
        // Fixed large radius for local contrast.
        const radius = 0.5;
        const blurPass = (inTex: WebGLTexture, outFb: WebGLFramebuffer | null, dir: [number, number]) => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
          gl.viewport(0, 0, ctx.width, ctx.height);
          gl.useProgram(blur);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, inTex);
          gl.uniform1i(gl.getUniformLocation(blur, 'u_texture'), 0);
          gl.uniform2f(gl.getUniformLocation(blur, 'u_texel'), texel[0], texel[1]);
          gl.uniform2f(gl.getUniformLocation(blur, 'u_direction'), dir[0], dir[1]);
          gl.uniform1f(gl.getUniformLocation(blur, 'u_radius'), radius);
          gl.uniform1i(gl.getUniformLocation(blur, 'u_useMask'), 0);
          drawQuad();
        };
        blurPass(inputTexture, scratchA.framebuffer, [texel[0], 0]); // H → scratchA
        blurPass(scratchA.texture, scratchB.framebuffer, [0, texel[1]]); // V → scratchB (blurred)
        // Combine original + blurred → target
        gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
        gl.viewport(0, 0, ctx.width, ctx.height);
        gl.useProgram(clarityProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_texture'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, scratchB.texture);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_blurred'), 1);
        gl.uniform1f(gl.getUniformLocation(clarityProgram, 'u_amount'), amount);
        gl.uniform1i(gl.getUniformLocation(clarityProgram, 'u_useMask'), 0);
        drawQuad();
      },
    });
```

> Place the clarity registration **after** the blur registration so `this.blurProgram` is set.

- [ ] **Step 4: Processing definition**

```tsx
// src/processing/clarity.tsx
import { Contrast } from 'lucide-react';
import type { ProcessingDefinition, ProcessingPanelProps } from '@/types/processing';
import { ScalarSectionBody } from '@/components/inspector/adjustments/ScalarSectionBody';

function ClarityPanel({ layerId }: ProcessingPanelProps) {
  return <ScalarSectionBody layerId={layerId} op="clarity" params={clarityProcessing.params} />;
}

export const clarityProcessing: ProcessingDefinition = {
  id: 'clarity',
  label: 'Clarity',
  icon: Contrast,
  category: 'adjust',
  adjustmentType: 'clarity',
  paramKeys: ['amount'],
  params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, default: 0 }],
  Panel: ClarityPanel,
};
```

Register in [processing/index.ts](../../../src/processing/index.ts).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/clarity.glsl.ts src/processing/clarity.tsx shared/engine-registry.json src/shaders/pipeline.ts src/processing/index.ts
git commit -m "feat(clarity): add local-contrast clarity op (blur + combine)"
```

- [ ] **Step 7: Manual verification**

Preview: add Clarity, raise Amount — midtone local contrast/"punch" increases without global contrast clipping.

---

## Phase 4b (optional) — mask-scoped fused tools

### Task 15 (optional): AI-composable sharpen/blur tools

**Files:**
- Create: `backend/app/tools/fused/sharpen_subject.py`, `backend/app/tools/fused/soften_background.py`
- Modify: `backend/app/tools/fused/__init__.py`

- [ ] **Step 1: Decide scope.** Only do this if you want the new ops AI-composable now. These fused templates emit a single `sharpen` (or `blur`) node with `amount`/`radius`, scoped to a subject / inverse-subject mask. Model them on [exposure_balance.py](../../../backend/app/tools/fused/exposure_balance.py) (node_skeleton + bindings_skeleton + param_envelope + a `resolve` returning the amount). Use `node_type="sharpen"` / `"blur"` and `tunable_param_keys=["amount"]` / `["radius"]`.

- [ ] **Step 2: Register them** in [fused/__init__.py](../../../backend/app/tools/fused/__init__.py) (import + yield in `all_fused_templates`).

- [ ] **Step 3: Verify the contract test still passes**

Run: `cd backend && pytest tests/tools/test_fused_params_in_registry.py -v`
Expected: PASS — `sharpen.amount` / `blur.radius` are in the registry from Phase 3/4.

- [ ] **Step 4: Commit**

```bash
git add backend/app/tools/fused/
git commit -m "feat(fused): add mask-scoped sharpen_subject + soften_background tools"
```

---

## Final verification

- [ ] Run `npm run check` — all green.
- [ ] Run `cd backend && pytest` — all green.
- [ ] Preview pass: load an image and confirm, for each new op (whites/blacks, HSL, sharpen, blur, clarity), the manual accordion slider moves pixels; and an `exposure_balance` AI suggestion's Whites/Blacks now visibly affect the canvas with live drag feedback.

## Self-review notes (already applied)

- **Spec coverage:** Phase 0 (whites/blacks) → Tasks 1–3; contract guard → Task 1; live-preview → Tasks 4–5; HSL → Tasks 6–10; convolution extension + sharpen → Tasks 11–12; blur+clarity → Tasks 13–14; optional fused tools → Task 15; parked doc already committed.
- **Known deviation from spec:** the kelvin `temperature` mismatch (discovered during planning) is allow-listed in the contract test as tracked debt, not fixed here.
- **Type consistency:** `RenderIntoCtx`/`renderInto` defined in Task 11 are used unchanged in Tasks 13–14; `useCanonicalParam(layerId, op, param, default)` signature matches its definition; `engineUniformValue(key, raw)` used consistently.
