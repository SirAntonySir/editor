# Phase 1 — Shared Engine Contract & Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every scalar toolstore/AI widget slider visibly change the image by introducing one shared engine registry that fixes the param scale/key drift; gate Refine/Why off toolstore widgets.

**Architecture:** A neutral `shared/engine-registry.json` declares, per op, the param keys, ranges, scale, uniform name, and shader binding. The frontend pipeline derives its uniform scaling from it (killing the `/100` guesswork) and the backend generates tool defaults from it (killing the `-1..1` vs `-100..100` drift and the `temp`/`black` key mismatches). Curves and LUT/filter controls need shader-level work and are explicitly deferred to Phase 2.

**Tech Stack:** TypeScript/React/Vite + Vitest (frontend); Python/FastAPI + pytest (backend); shared JSON contract.

**Scope (this plan):** ops `light`, `color`, `kelvin`, `levels`. **Out of scope (Phase 2):** `curves` (needs real curve editor; shader reads LUT textures, not a scalar) and `lut`/`filter` (shader applies a full LUT by id, no intensity blend). These remain as-is and stay non-functional until Phase 2 — this is logged, not silently hidden.

---

## File Structure

- Create `shared/engine-registry.json` — the single contract (scalar ops).
- Create `src/engine/registry.ts` — typed frontend accessor + pure `engineUniformValue`.
- Create `src/engine/registry.test.ts` — frontend contract tests.
- Modify `tsconfig.app.json` — enable `resolveJsonModule`.
- Create `backend/app/engine/__init__.py`, `backend/app/engine/registry.py` — backend loader.
- Create `backend/tests/engine/test_registry.py` — backend contract tests.
- Modify `backend/app/tools/tool_defaults.py` — generate the 4 scalar ops from the registry.
- Modify `backend/tests/tools/` — add `test_tool_defaults_contract.py`.
- Modify `src/shaders/pipeline.ts` — drive scalar uniform scaling via `engineUniformValue`.
- Modify `src/components/widget/WidgetShellFooter.tsx` + `WidgetShell.tsx` — gate Refine/Why on origin.
- Modify `src/components/widget/WidgetShell.test.tsx` — footer gating test.

---

## Task 1: Shared engine registry JSON + frontend accessor

**Files:**
- Create: `shared/engine-registry.json`
- Create: `src/engine/registry.ts`
- Create: `src/engine/registry.test.ts`
- Modify: `tsconfig.app.json` (add `resolveJsonModule`)

- [ ] **Step 1: Write the registry JSON**

Create `shared/engine-registry.json`:

```json
{
  "ops": {
    "light": {
      "shaderBinding": "basic",
      "toolDefaults": ["exposure", "contrast", "highlights", "shadows"],
      "params": {
        "exposure":   { "uniform": "u_exposure",   "label": "Exposure",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "contrast":   { "uniform": "u_contrast",   "label": "Contrast",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "highlights": { "uniform": "u_highlights", "label": "Highlights", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "shadows":    { "uniform": "u_shadows",    "label": "Shadows",    "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "brightness": { "uniform": "u_brightness", "label": "Brightness", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 }
      }
    },
    "color": {
      "shaderBinding": "basic",
      "toolDefaults": ["saturation", "vibrance"],
      "params": {
        "saturation": { "uniform": "u_saturation", "label": "Saturation", "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "vibrance":   { "uniform": "u_vibrance",   "label": "Vibrance",   "min": -100, "max": 100, "step": 1, "scale": 100, "default": 0 },
        "hue":        { "uniform": "u_hue",        "label": "Hue",        "min": 0,    "max": 360, "step": 1, "scale": "deg2rad", "default": 0 }
      }
    },
    "kelvin": {
      "shaderBinding": "kelvin",
      "toolDefaults": ["kelvin", "tint"],
      "params": {
        "kelvin": { "uniform": "u_kelvin", "label": "Temperature", "min": 2000, "max": 10000, "step": 50, "scale": 1,   "default": 6500 },
        "tint":   { "uniform": "u_tint",   "label": "Tint",        "min": -100, "max": 100,   "step": 1,  "scale": 100, "default": 0 }
      }
    },
    "levels": {
      "shaderBinding": "levels",
      "toolDefaults": ["inBlack", "inWhite", "gamma"],
      "params": {
        "inBlack":  { "uniform": "u_inBlack",  "label": "Black Point", "min": 0,   "max": 255, "step": 1,    "scale": 255, "default": 0 },
        "inWhite":  { "uniform": "u_inWhite",  "label": "White Point", "min": 0,   "max": 255, "step": 1,    "scale": 255, "default": 255 },
        "gamma":    { "uniform": "u_gamma",    "label": "Gamma",       "min": 0.1, "max": 3,   "step": 0.01, "scale": 1,   "default": 1 },
        "outBlack": { "uniform": "u_outBlack", "label": "Output Black","min": 0,   "max": 255, "step": 1,    "scale": 255, "default": 0 },
        "outWhite": { "uniform": "u_outWhite", "label": "Output White","min": 0,   "max": 255, "step": 1,    "scale": 255, "default": 255 }
      }
    }
  }
}
```

> **Why `toolDefaults` is separate from `params`:** `params` is the full engine contract (every param the shader reads — needed so the pipeline scales `brightness`, `outBlack`, etc. correctly). `toolDefaults` is the curated subset each toolstore tool exposes today, so the existing tool UIs stay identical while keys/scales get fixed.

- [ ] **Step 2: Enable JSON imports in TypeScript**

In `tsconfig.app.json`, inside `compilerOptions`, add:

```jsonc
    "resolveJsonModule": true,
```

- [ ] **Step 3: Write the failing frontend accessor test**

Create `src/engine/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { engineUniformValue, engineParam, ENGINE_OPS } from './registry';

describe('engine registry', () => {
  it('scales exposure by 100 (−100..100 → −1..1 for the shader)', () => {
    expect(engineUniformValue('exposure', 100)).toBeCloseTo(1);
    expect(engineUniformValue('exposure', -50)).toBeCloseTo(-0.5);
  });

  it('converts hue degrees to radians', () => {
    expect(engineUniformValue('hue', 180)).toBeCloseTo(Math.PI);
  });

  it('passes kelvin through unscaled', () => {
    expect(engineUniformValue('kelvin', 6500)).toBe(6500);
  });

  it('exposes param metadata with the canonical range', () => {
    expect(engineParam('exposure')).toMatchObject({ uniform: 'u_exposure', min: -100, max: 100 });
  });

  it('uses canonical keys — no legacy temp/black aliases', () => {
    const allParamKeys = Object.values(ENGINE_OPS).flatMap((op) => Object.keys(op.params));
    expect(allParamKeys).toContain('kelvin');
    expect(allParamKeys).toContain('inBlack');
    expect(allParamKeys).not.toContain('temp');
    expect(allParamKeys).not.toContain('black');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/engine/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`.

- [ ] **Step 5: Write the accessor**

Create `src/engine/registry.ts`:

```ts
import registryJson from '../../shared/engine-registry.json';

export type EngineScale = number | 'deg2rad';

export interface EngineParam {
  uniform: string;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: EngineScale;
  default: number;
}

export interface EngineOp {
  shaderBinding: string;
  /** Curated subset of param keys the default toolstore tool exposes. */
  toolDefaults: string[];
  params: Record<string, EngineParam>;
}

export const ENGINE_OPS: Record<string, EngineOp> = (registryJson as { ops: Record<string, EngineOp> }).ops;

/** Flat param-key → spec map. Scalar param keys are unique across the Phase 1 ops. */
const FLAT_PARAMS: Record<string, EngineParam> = Object.fromEntries(
  Object.values(ENGINE_OPS).flatMap((op) => Object.entries(op.params)),
);

export function engineParam(paramKey: string): EngineParam | undefined {
  return FLAT_PARAMS[paramKey];
}

/** Convert a canonical param value into the shader-uniform value using the registry scale. */
export function engineUniformValue(paramKey: string, raw: number): number {
  const p = FLAT_PARAMS[paramKey];
  if (!p) return raw;
  if (p.scale === 'deg2rad') return (raw * Math.PI) / 180;
  return raw / p.scale;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/engine/registry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add shared/engine-registry.json src/engine/registry.ts src/engine/registry.test.ts tsconfig.app.json
git commit -m "feat(engine): shared engine registry + frontend accessor"
```

---

## Task 2: Backend registry loader

**Files:**
- Create: `backend/app/engine/__init__.py`
- Create: `backend/app/engine/registry.py`
- Create: `backend/tests/engine/__init__.py`
- Create: `backend/tests/engine/test_registry.py`

- [ ] **Step 1: Write the failing backend test**

Create `backend/tests/engine/__init__.py` (empty) and `backend/tests/engine/test_registry.py`:

```python
from app.engine.registry import ENGINE_OPS, op_param


def test_registry_loads_scalar_ops():
    assert set(ENGINE_OPS) == {"light", "color", "kelvin", "levels"}


def test_exposure_range_and_scale_match_frontend():
    p = op_param("light", "exposure")
    assert p["min"] == -100 and p["max"] == 100 and p["scale"] == 100


def test_canonical_keys_no_legacy_aliases():
    kelvin_keys = set(ENGINE_OPS["kelvin"]["params"])
    levels_keys = set(ENGINE_OPS["levels"]["params"])
    assert "kelvin" in kelvin_keys and "temp" not in kelvin_keys
    assert "inBlack" in levels_keys and "black" not in levels_keys
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/engine/test_registry.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engine'`.

- [ ] **Step 3: Write the loader**

Create `backend/app/engine/__init__.py` (empty) and `backend/app/engine/registry.py`:

```python
"""Loads the shared engine registry (the single param contract).

Same JSON the frontend imports — guarantees param keys, ranges and scale never
drift between backend defaults and the WebGL pipeline."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

# backend/app/engine/registry.py → parents[3] == repo root
_REGISTRY_PATH = Path(__file__).resolve().parents[3] / "shared" / "engine-registry.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    with _REGISTRY_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def _ops() -> dict[str, Any]:
    return _load()["ops"]


# Eager snapshot for ergonomic access (registry is static at runtime).
ENGINE_OPS: dict[str, Any] = _ops()


def op_param(op: str, key: str) -> dict[str, Any]:
    return ENGINE_OPS[op]["params"][key]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/engine/test_registry.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/engine backend/tests/engine
git commit -m "feat(engine): backend loader for shared engine registry"
```

---

## Task 3: Generate scalar tool defaults from the registry

**Files:**
- Modify: `backend/app/tools/tool_defaults.py`
- Create: `backend/tests/tools/test_tool_defaults_contract.py`

- [ ] **Step 1: Write the failing contract test**

Create `backend/tests/tools/test_tool_defaults_contract.py`:

```python
from app.tools.tool_defaults import TOOL_DEFAULTS


def _binding(tool: str, key: str) -> dict:
    return next(b for b in TOOL_DEFAULTS[tool]["bindings"] if b["param_key"] == key)


def test_light_exposure_uses_canonical_range():
    b = _binding("light", "exposure")
    assert b["control_schema"]["min"] == -100
    assert b["control_schema"]["max"] == 100
    # node param key matches the binding key
    assert "exposure" in TOOL_DEFAULTS["light"]["nodes"][0]["params"]
    # node.type is the shader binding
    assert TOOL_DEFAULTS["light"]["nodes"][0]["type"] == "basic"


def test_kelvin_uses_canonical_key_not_temp():
    keys = {b["param_key"] for b in TOOL_DEFAULTS["kelvin"]["bindings"]}
    assert "kelvin" in keys and "temp" not in keys
    assert "kelvin" in TOOL_DEFAULTS["kelvin"]["nodes"][0]["params"]


def test_levels_uses_inblack_not_black():
    keys = {b["param_key"] for b in TOOL_DEFAULTS["levels"]["bindings"]}
    assert "inBlack" in keys and "black" not in keys
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_tool_defaults_contract.py -q`
Expected: FAIL — kelvin still exposes `temp`, levels exposes `black`, exposure range is `-1..1`.

- [ ] **Step 3: Generate the scalar ops from the registry**

In `backend/app/tools/tool_defaults.py`, replace the `light`, `color`, `kelvin`, `levels` entries with a registry-driven generator. Keep `curves` and `filter` exactly as they are. New file content:

```python
"""Per-tool default node + binding payloads for tool_invoked widgets.

Scalar ops (light, color, kelvin, levels) are GENERATED from the shared engine
registry so param keys, ranges and scale never drift from the shader pipeline.
curves + filter are LUT/texture based and stay hand-written until Phase 2.
"""
from typing import Any

from app.engine.registry import ENGINE_OPS

_SCALAR_OPS = ("light", "color", "kelvin", "levels")


def _scalar_tool(op: str) -> dict[str, Any]:
    spec = ENGINE_OPS[op]
    shader_binding = spec["shaderBinding"]
    params = spec["params"]
    exposed = spec["toolDefaults"]  # curated subset the tool shows today
    node_params = {key: params[key]["default"] for key in exposed}
    bindings = [
        {
            "param_key": key,
            "label": params[key]["label"],
            "control_type": "slider",
            "control_schema": {
                "control_type": "slider",
                "min": params[key]["min"],
                "max": params[key]["max"],
                "step": params[key]["step"],
            },
            "value": params[key]["default"],
            "default": params[key]["default"],
        }
        for key in exposed
    ]
    return {"nodes": [{"type": shader_binding, "params": node_params}], "bindings": bindings}


TOOL_DEFAULTS: dict[str, dict[str, Any]] = {op: _scalar_tool(op) for op in _SCALAR_OPS}

# --- LUT / texture ops: hand-written, Phase 2 will give them real controls ----
TOOL_DEFAULTS["curves"] = {
    "nodes": [{"type": "curves", "params": {"intensity": 1.0}}],
    "bindings": [
        {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
         "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
         "value": 1.0, "default": 1.0},
    ],
}
TOOL_DEFAULTS["filter"] = {
    "nodes": [{"type": "lut", "params": {"intensity": 1.0}}],
    "bindings": [
        {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
         "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
         "value": 1.0, "default": 1.0},
    ],
}
```

- [ ] **Step 4: Run the contract test + existing tool tests**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_tool_defaults_contract.py tests/tools/widgets/test_propose_widget_layer_origin.py -q`
Expected: PASS. (The `tool_invoked` propose tests still pass — node.type is unchanged for light/levels; kelvin node.type stays `kelvin`.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/tool_defaults.py backend/tests/tools/test_tool_defaults_contract.py
git commit -m "feat(engine): generate scalar tool defaults from the registry (fix ranges/keys)"
```

---

## Task 4: Drive pipeline uniform scaling from the registry

**Files:**
- Modify: `src/shaders/pipeline.ts:131-201` (the `basic`, `levels`, `kelvin` `setUniforms`)

**Note:** WebGL execution isn't unit-tested here; correctness of the scale lives in `engineUniformValue` (Task 1, already tested). This task wires the pipeline to that one function, removing the hardcoded divisors.

- [ ] **Step 1: Import the helper**

At the top of `src/shaders/pipeline.ts`, add to the imports:

```ts
import { engineUniformValue } from '@/engine/registry';
```

- [ ] **Step 2: Replace the `basic` program uniform block**

Replace `src/shaders/pipeline.ts:133-141` with:

```ts
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), engineUniformValue('brightness', (p.brightness as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), engineUniformValue('contrast', (p.contrast as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_saturation'), engineUniformValue('saturation', (p.saturation as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_hue'), engineUniformValue('hue', (p.hue as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_temperature'), ((p.temperature as number) ?? 0) / 100);
        gl.uniform1f(gl.getUniformLocation(program, 'u_exposure'), engineUniformValue('exposure', (p.exposure as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_highlights'), engineUniformValue('highlights', (p.highlights as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_shadows'), engineUniformValue('shadows', (p.shadows as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_vibrance'), engineUniformValue('vibrance', (p.vibrance as number) ?? 0));
```

(Note: `brightness` IS in the registry (`light` op contract, not in `toolDefaults`) so `engineUniformValue('brightness', …)` scales it correctly. `temperature` is a legacy alias NOT in the Phase 1 op set, so `engineUniformValue` would return it raw — keep it on the explicit `/100` as shown above.)

- [ ] **Step 3: Replace the `levels` program uniform block**

Replace `src/shaders/pipeline.ts:184-188` with:

```ts
        gl.uniform1f(gl.getUniformLocation(program, 'u_inBlack'), engineUniformValue('inBlack', (p.inBlack as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_inWhite'), engineUniformValue('inWhite', (p.inWhite as number) ?? 255));
        gl.uniform1f(gl.getUniformLocation(program, 'u_gamma'), engineUniformValue('gamma', (p.gamma as number) ?? 1.0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_outBlack'), engineUniformValue('outBlack', (p.outBlack as number) ?? 0));
        gl.uniform1f(gl.getUniformLocation(program, 'u_outWhite'), engineUniformValue('outWhite', (p.outWhite as number) ?? 255));
```

- [ ] **Step 4: Replace the `kelvin` program uniform block**

Replace `src/shaders/pipeline.ts:198-199` with:

```ts
        gl.uniform1f(gl.getUniformLocation(program, 'u_kelvin'), engineUniformValue('kelvin', (p.kelvin as number) ?? 6500));
        gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), engineUniformValue('tint', (p.tint as number) ?? 0));
```

- [ ] **Step 5: Typecheck + full frontend check**

Run: `npm run check`
Expected: PASS (tsc + eslint + all vitest). No behavior regression in existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/shaders/pipeline.ts
git commit -m "feat(engine): drive pipeline uniform scaling from the shared registry"
```

---

## Task 5: Gate Refine/Why off toolstore widgets

**Files:**
- Modify: `src/components/widget/WidgetShellFooter.tsx`
- Modify: `src/components/widget/WidgetShell.tsx:147-160` (footer render)
- Modify: `src/components/widget/WidgetShell.test.tsx`

- [ ] **Step 1: Write the failing footer test**

Add to `src/components/widget/WidgetShell.test.tsx` (follow the file's existing render/setup helpers; use the existing `tool_invoked` fixture from `src/components/widget/__fixtures__/widgets.ts`):

```tsx
it('hides Refine/Why for tool_invoked widgets', () => {
  const widget = makeWidget({ origin: { kind: 'tool_invoked' }, status: 'active' });
  renderShellExpanded(widget); // existing helper that mounts WidgetShell expanded
  expect(screen.queryByText('Refine')).toBeNull();
  expect(screen.queryByText('Why?')).toBeNull();
});

it('shows Refine/Why for AI widgets', () => {
  const widget = makeWidget({ origin: { kind: 'mcp_autonomous', prompt: null }, status: 'active' });
  renderShellExpanded(widget);
  expect(screen.getByText('Refine')).toBeInTheDocument();
});
```

> If `renderShellExpanded`/`makeWidget` helpers don't already exist in the test file, add a minimal local helper that renders `<WidgetShell widget={widget} />` and clicks the header to expand, mirroring the existing tests in that file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: FAIL — Refine/Why render regardless of origin.

- [ ] **Step 3: Add the gating prop to the footer**

In `src/components/widget/WidgetShellFooter.tsx`, add `showAiAffordances?: boolean` (default `true`) and wrap the Refine button + the `whyButton`/Why fallback so they only render when true. Updated component:

```tsx
import { type ReactNode } from 'react';
import { RotateCcw, HelpCircle } from 'lucide-react';

interface WidgetShellFooterProps {
  onRefine: () => void;
  onWhy: () => void;
  onReset: () => void;
  onApply: () => void;
  applyDisabled: boolean;
  /** AI affordances (Refine/Why). Hidden for deterministic tool_invoked widgets. */
  showAiAffordances?: boolean;
  whyButton?: ReactNode;
}

export function WidgetShellFooter({
  onRefine, onWhy, onReset, onApply, applyDisabled, showAiAffordances = true, whyButton,
}: WidgetShellFooterProps) {
  return (
    <div className="flex items-center gap-px px-1.5 pt-1 pb-1.5 border-t border-separator">
      {showAiAffordances && (
        <>
          <button
            onClick={onRefine}
            className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
          >
            <RotateCcw size={10} aria-hidden /> Refine
          </button>
          {whyButton ?? (
            <button
              onClick={onWhy}
              className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
            >
              <HelpCircle size={10} aria-hidden /> Why?
            </button>
          )}
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={onReset}
        className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary"
      >
        Reset
      </button>
      <button
        onClick={onApply}
        disabled={applyDisabled}
        className="text-[10px] bg-accent text-white border border-accent rounded-[4px] px-2 py-0.5 hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed ml-1"
      >
        Apply
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Pass the flag from WidgetShell**

In `src/components/widget/WidgetShell.tsx`, where `<WidgetShellFooter ... />` is rendered (around line 147), add the prop derived from origin. Also skip the RefineInput toggle for tool_invoked. Add near the top of the component body:

```tsx
const showAiAffordances = widget.origin.kind !== 'tool_invoked';
```

Then on the footer element add:

```tsx
            showAiAffordances={showAiAffordances}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/widget/WidgetShellFooter.tsx src/components/widget/WidgetShell.tsx src/components/widget/WidgetShell.test.tsx
git commit -m "feat(widget): hide Refine/Why on deterministic tool_invoked widgets"
```

---

## Task 6: Lock the optimistic key to node_id (regression guard)

**Files:**
- Modify: `src/components/widget/WidgetShell.test.tsx`

**Context:** the active write path (`WidgetShell.setParam`) already keys optimistic patches by `binding.target.node_id`, which is what the renderer (`withOptimistic`) looks up. The orphaned `use-processing-param` path keys by `widgetId` but is not rendered (Phase 2 reconciles it). This task adds a regression test so the active path can't silently drift back.

- [ ] **Step 1: Write the test**

Add to `src/components/widget/WidgetShell.test.tsx`:

```tsx
it('keys the optimistic patch by the binding target node_id', () => {
  const applySpy = vi.spyOn(useBackendState.getState(), 'applyOptimistic');
  const widget = makeWidget({
    origin: { kind: 'tool_invoked' }, status: 'active',
    bindings: [sliderBinding({ param_key: 'exposure', node_id: 'n_abc' })],
  });
  renderShellExpanded(widget);
  fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
  expect(applySpy).toHaveBeenCalledWith('n_abc', expect.objectContaining({
    bindings: [expect.objectContaining({ paramKey: 'exposure', value: 40 })],
  }));
});
```

> Use the file's existing helpers; if `sliderBinding` doesn't exist, build a binding inline with `control_type: 'slider'`, `control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 }`, and `target: { node_id: 'n_abc', param_key: 'exposure' }`. Ensure a backend session + snapshot are set so `setParam`'s `offline` guard passes (mirror the existing slider tests in this file).

- [ ] **Step 2: Run the test to verify it passes (or fails honestly)**

Run: `npx vitest run src/components/widget/WidgetShell.test.tsx`
Expected: PASS (the behavior already exists; this is a guard). If it FAILS, the active path regressed — fix `setParam` in `WidgetShell.tsx` to key by `binding.target.node_id`.

- [ ] **Step 3: Commit**

```bash
git add src/components/widget/WidgetShell.test.tsx
git commit -m "test(widget): lock optimistic patch key to binding node_id"
```

---

## Task 7: Full verification + live smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend + backend suites**

Run: `npm run check`
Expected: PASS (tsc + eslint + vitest).

Run: `cd backend && source .venv/bin/activate && python -m pytest -q`
Expected: PASS except the pre-existing `tests/test_panel_endpoint.py::test_panel_reuses_cached_context` (missing `ANTHROPIC_API_KEY` — environmental, unrelated).

- [ ] **Step 2: Live smoke (real slider, not injection)**

Start the app (`npm run dev` + backend running). Open an image, select the ImageNode, click **Light**, drag the **Exposure** slider to the top. Confirm the image visibly brightens. Repeat for **Color → Saturation** and **Kelvin → Temperature**. Confirm a **tool_invoked** widget shows **no Refine/Why**.

- [ ] **Step 3: Commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(engine): phase 1 verification fixups"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 rows of §5):** shared registry (Tasks 1–2) ✓; route BE defaults (Task 3) ✓; pipeline mapping via registry (Task 4) ✓; toolstore drops Refine/Why (Task 5) ✓; optimistic key (Task 6) ✓. Curves/LUT controls explicitly deferred to Phase 2 and logged (Scope block) — not silently dropped.
- **Type consistency:** `engineUniformValue(paramKey, raw)` and `engineParam(paramKey)` are used identically in Tasks 1 and 4; `ENGINE_OPS` shape matches between `registry.ts` and `registry.py`; `op_param(op, key)` used only in backend tests.
- **No placeholders:** all code blocks are concrete. The two `>` notes (test-helper reuse) point at existing patterns in the named test files rather than inventing APIs.
