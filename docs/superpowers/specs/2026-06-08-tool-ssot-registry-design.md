# Tool SSoT Registry + Composition Planner — Design

**Status:** Draft
**Date:** 2026-06-08
**Author:** Anton (with Claude)
**Branch:** to be created off `feat/canvas-workspace`

---

## 1. Problem

There are four catalogs in the codebase that disagree about what tools exist:

| # | File / dir | What it lists | Read by |
|---|------------|---------------|---------|
| 1 | `shared/engine-registry.json` | 11 raw WebGL ops (light, color, kelvin, levels, hsl, sharpen, blur, clarity, grain, vignette, splitTone) — engine config only | Frontend + backend |
| 2 | `backend/app/tools/tool_defaults.py` | Hand-written `{nodes, bindings}` payloads per tool id used by toolrail (`origin: tool_invoked`) | Backend |
| 3 | `backend/app/tools/fused/` | 40+ "fused" template Python classes (vintage, moody, teal_orange, …) with `description`, `typical_use`, `param_envelope`, `resolve()` | Backend — what the LLM picks from |
| 4 | `src/lib/tool-manifest/llm-tool-registry.ts` + `src/processing/*.tsx` | LLM-facing tool manifest and 11 bespoke frontend Panels | Frontend |

To add **grain** as a real tool today requires editing all four catalogs plus the toolrail file. Six places, easy to miss one, hard to keep in sync.

The user-visible symptom: typing *"make it look like a vintage film"* in Cmd+K spawns **one HSL widget with red hue at −8** — because the LLM is a template picker, not a composer. It can pick one fused template; it cannot stack curves + split-tone + grain + HSL + levels. The catalogs `grain`, `splitTone`, `vignette` exist in the engine but are invisible to the LLM.

## 2. Goals

1. **Single source of truth.** Adding or removing a tool happens in exactly one file.
2. **Multi-op composition.** The LLM can spawn 1–6 widgets per intent, each independently refineable.
3. **Rich param schemas.** Curves resolve to point lists, split-tone to color pairs, grain to multi-param textures — not scalar envelopes.
4. **Frontend modularity.** Inspector Panels render from the registry, not from 11 bespoke files.
5. **Extension point for user-saved presets.** Architecture supports them; UI is out of scope.

## 3. Non-goals

- Fancy UI controls (catmull-rom curve editor, color wheel polish). Basic controls only.
- Save-preset UI / round-trip from canvas to JSON. Loader supports user-preset sources; the save flow is a follow-up spec.
- New tools beyond what already exists. This spec restructures, it does not invent ops.
- Replacing the WebGL pipeline. Ops still render via the existing shader system.
- Backend session/multi-user concerns. Single-user local thesis context.

## 4. Architecture

### 4.1 Directory layout

```
shared/registry/
  ops/
    light.json
    color.json
    kelvin.json
    curves.json          # rich schema: point list per channel
    levels.json
    hsl.json
    sharpen.json
    blur.json
    clarity.json
    grain.json           # multi-param: amount, size, roughness
    splitTone.json       # rich schema: shadow + highlight color pairs
    vignette.json        # amount, feather, center
  presets/
    vintage.json         # ex-fused-template, demoted to JSON
    moody.json
    teal_orange.json
    ...                  # all 40+ ex-fused templates
  schema.ts              # TypeScript types
  index.json             # build manifest (op ids + preset ids; auto-generated)
```

The existing `shared/engine-registry.json` is **absorbed** into per-op files (its render-order and engine fields move into each op's `engine` block).

### 4.2 Op file schema

Each `ops/<id>.json` has four sections:

```jsonc
{
  "id": "splitTone",
  "display_name": "Split Tone",

  // --- LLM-facing ---
  "llm": {
    "description": "Color-tones shadows and highlights independently. Classic for cinematic looks.",
    "typical_use": "Cinematic teal-orange grading, warm/cool moods, vintage film color casts",
    "semantic_tags": ["color-grade", "mood", "vintage", "cinematic"]
  },

  // --- Param schema (rich, typed) ---
  "params": {
    "shadow_hue":    { "type": "scalar", "range": [0, 360],   "default": 200, "unit": "deg" },
    "shadow_sat":    { "type": "scalar", "range": [0, 100],   "default": 30 },
    "highlight_hue": { "type": "scalar", "range": [0, 360],   "default": 30,  "unit": "deg" },
    "highlight_sat": { "type": "scalar", "range": [0, 100],   "default": 25 },
    "balance":       { "type": "scalar", "range": [-100, 100],"default": 0 }
  },

  // --- Frontend rendering hints ---
  "bindings": [
    { "param_key": "shadow_hue",    "control_type": "hue_wheel", "group": "Shadows",    "label": "Hue" },
    { "param_key": "shadow_sat",    "control_type": "slider",    "group": "Shadows",    "label": "Saturation" },
    { "param_key": "highlight_hue", "control_type": "hue_wheel", "group": "Highlights", "label": "Hue" },
    { "param_key": "highlight_sat", "control_type": "slider",    "group": "Highlights", "label": "Saturation" },
    { "param_key": "balance",       "control_type": "slider",    "group": "Balance",    "label": "Balance" }
  ],

  // --- Engine config ---
  "engine": {
    "shader": "splitTone",
    "render_order": 50,
    "node_type": "splitTone"
  }
}
```

**Param types supported in v1:**

| Type | Shape | Frontend control |
|---|---|---|
| `scalar` | `{ range: [min, max], default: number, unit?: string }` | `slider` / `hue_wheel` / `kelvin_strip` |
| `curve_points` | `{ default: [[x,y], …], min_points: 2, max_points: 16 }` | `curve_editor` (basic v1) |
| `color_hsv` | `{ default: { h, s, v } }` | `swatch` / `color_picker` |
| `enum` | `{ values: string[], default: string }` | `enum_select` |
| `bool` | `{ default: boolean }` | `bool_toggle` |

Validation lives in the schema. The backend Pydantic loader rejects invalid op files at startup; the frontend TS loader fails the build.

### 4.3 Preset file schema

```jsonc
{
  "id": "vintage",
  "display_name": "Vintage Film",
  "source": "builtin",                // "builtin" | "user" | "project"
  "description": "Lifted blacks, faded film contrast, warm color shift, fine grain",
  "typical_use": "Aged-photo aesthetic, 70s-film vibes, nostalgic portraits",
  "semantic_tags": ["mood", "vintage", "film", "warm"],

  "ops": [
    { "op_id": "levels",    "params": { "in_black": 12, "in_white": 245, "gamma": 1.0 } },
    { "op_id": "color",     "params": { "saturation": -15 } },
    { "op_id": "hsl",       "params": { "red_hue": 8, "yellow_hue": 12 } },
    { "op_id": "splitTone", "params": { "shadow_hue": 210, "shadow_sat": 18,
                                         "highlight_hue": 35, "highlight_sat": 22,
                                         "balance": -10 } },
    { "op_id": "grain",     "params": { "amount": 18, "size": 1.2, "roughness": 0.4 } }
  ]
}
```

Presets are **named stacks of raw ops with starting params**. They are *not* a separate execution path. When the planner picks a preset, the handler unfolds it into N widgets — each user-refineable like any other.

### 4.4 Loaders

**Backend** — `backend/app/registry/loader.py`:
- Reads `shared/registry/ops/*.json` and `shared/registry/presets/*.json` at startup.
- Reads `~/.editor/presets/*.json` if present (user source).
- Future: reads embedded presets from `.edp` project files (project source).
- Validates each file via Pydantic models in `backend/app/registry/schema.py`.
- Exposes `Registry.ops: dict[str, RegistryOp]`, `Registry.presets: dict[str, RegistryPreset]`.
- Replaces `tool_defaults.py` and the `fused/` directory.

**Frontend** — `src/lib/registry/loader.ts`:
- Reads `shared/registry/**/*.json` via Vite's `import.meta.glob('shared/registry/**/*.json', { eager: true })`.
- Validates against `shared/registry/schema.ts` (Zod or plain TS guards).
- Exposes a singleton consumed by `ProcessingRegistry`, `CanvasToolRegistry`, and the LLM tool manifest.

### 4.5 Frontend control library

```
src/components/registry-controls/
  Slider.tsx
  Swatch.tsx
  HueWheel.tsx
  CurveEditor.tsx      // basic v1: drag points on a 1D canvas
  PointList.tsx
  EnumSelect.tsx
  BoolToggle.tsx
  KelvinStrip.tsx
  index.ts             // control_type → component map
```

A new `<RegistryDrivenPanel op={op} />` reads `op.bindings`, groups by `group` field, and renders one control per binding. The 11 bespoke `src/processing/*.tsx` Panel files are replaced.

## 5. Planner flow

### 5.1 LLM tool surface

**The LLM-facing mutation tool collapses to one:** `propose_stack`. Old `propose_widget` becomes an internal helper inside the `propose_stack` handler. Toolrail clicks (`origin: tool_invoked`) also route through `propose_stack` with a single-op list — one execution path for everything that lands on the canvas.

```python
class ProposeStackInput(BaseModel):
    intent: str
    scope: dict                       # global | region | etc.
    origin: WidgetOriginKind          # mcp_user_prompt | mcp_autonomous | tool_invoked
    layer_id: str = "legacy"
    forced_ops: list[str] | None = None   # bypass Phase 1 for toolrail
    prompt: str | None = None
```

### 5.2 Two-phase flow (`mcp_user_prompt`)

```
Frontend Cmd+K: "make it look like a vintage film"
  → backendTools.propose_stack({ intent, scope, origin: "mcp_user_prompt" })
  ↓
Backend POST /tools/propose_stack:

  PHASE 1 — PLAN (1 LLM call, Opus)
    System prompt (large, persistent prompt-cache):
      - Role description ("You are a photo-editing planner...")
      - Full registry catalog: every op's {id, description, typical_use, semantic_tags, params}
      - Full preset catalog: every preset's {id, description, ops_summary}
      - Composition examples (3-5 worked examples like vintage, golden-hour, cinematic)
      - Rules: "Prefer raw ops. Use a preset only when the intent matches closely.
        Unfold a preset and modify if useful. Return 1-6 ops."
    User payload:
      - intent
      - scope
      - image_context (palette, histogram, lighting_character)
      - existing_widgets summary (so it doesn't duplicate work already on the canvas)
    Response schema:
      {
        plan: [
          { op_id: string,
            rationale: string,
            preset_anchor?: string,         // if this op came from a preset
            starting_params?: dict          // if preset_anchor set, these are the preset's params
          }
        ],
        overall_rationale: string,
        chosen_preset?: string              // if planner anchored on a preset whole-cloth
      }

  PHASE 2 — RESOLVE (N parallel LLM calls, one per planned op)
    For each op in plan:
      System prompt (per-op-type, persistent prompt-cache):
        - "Resolve numeric values for {op_id} given the intent and image context."
        - The op's full typed param schema (from registry)
        - "If starting_params were provided, treat them as a strong prior and adjust."
      User payload:
        - intent
        - op-specific rationale from Phase 1
        - starting_params (if any)
        - image_context
      Response schema: the op's typed param schema
      Validation: clamp to envelopes; retry up to 3x on envelope violation; drop op on persistent failure

  ASSEMBLY:
    - For each resolved op, build a Widget {nodes, bindings} from the registry's
      `bindings` block + resolved params (display_name from registry; planner may override)
    - Add all widgets to doc.operation_graph in one atomic update
    - SSE broadcasts widget.created per widget; frontend lays out via nextSpawnPositionFor
```

### 5.3 Other origins

- **`mcp_autonomous`** (backend self-triggered analyze): same as `mcp_user_prompt` but skips user-intent and conditions on image_context only.
- **`tool_invoked`** (toolrail click): `forced_ops: ["curves"]` → skip Phase 1 entirely → Phase 2 with registry defaults (no LLM call needed if the registry's default params suffice; one LLM call for image-aware defaults if desired — flag, default off).

### 5.4 Failure handling

- Phase 1 returns empty / invalid JSON: fall back to keyword-matched preset (e.g. intent contains "vintage" → `presets/vintage.json`). If no match, fall back to `warm_grade`-equivalent preset.
- Phase 2 op fails after 3 retries: drop that op, continue with the rest. Emit SSE warning `widget.resolve_failed` so the UI can surface it.
- Either phase exceeds total deadline (e.g. 10s): cancel remaining work, ship what completed.

### 5.5 Caching

- Phase 1 system prompt + catalog block: `cache_control: persistent` (Anthropic prompt cache). Stable per session; the catalog only changes on registry file edits.
- Phase 2 system prompt per op type: `cache_control: persistent`.
- Image context block: `cache_control: ephemeral` (shared across phase 1 + 2 within a turn).

## 6. Data flow diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    shared/registry/                              │
│  ops/*.json   presets/*.json   (+ ~/.editor/presets, .edp)      │
└─────────────────────────────────────────────────────────────────┘
              │                                  │
              ▼                                  ▼
  ┌─────────────────────────┐      ┌──────────────────────────────┐
  │ backend/app/registry/   │      │ src/lib/registry/            │
  │   loader.py             │      │   loader.ts                  │
  │   schema.py (Pydantic)  │      │   schema.ts (Zod/TS guards)  │
  └─────────────────────────┘      └──────────────────────────────┘
              │                                  │
              ▼                                  ▼
  ┌─────────────────────────┐      ┌──────────────────────────────┐
  │ propose_stack handler   │      │ ProcessingRegistry           │
  │   Phase 1: planner LLM  │      │ CanvasToolRegistry           │
  │   Phase 2: resolve LLMs │      │ LlmToolRegistry              │
  │   assembly → widgets    │      │ <RegistryDrivenPanel>        │
  └─────────────────────────┘      └──────────────────────────────┘
              │                                  ▲
              └──────► SSE: widget.created ──────┘
```

## 7. Migration plan

Six commits, each ships independently. The editor keeps working between every commit.

### Commit 1 — Registry scaffolding & loader (no behavior change)
- Create `shared/registry/ops/` and `shared/registry/presets/`.
- Write `shared/registry/schema.ts` + `backend/app/registry/schema.py`.
- Write loaders `backend/app/registry/loader.py` and `src/lib/registry/loader.ts`.
- Author all 11 op JSON files by translating from existing sources: engine config from `shared/engine-registry.json`, defaults from `tool_defaults.py`, bindings from `src/processing/*.tsx`.
- No consumer code yet. Pure data migration.
- **Verification:** loader unit tests pass; no runtime behavior change.

### Commit 2 — Demote fused templates to JSON presets
- Write `backend/scripts/migrate_fused_to_presets.py` — reads each template class, extracts description, typical_use, default params, target ops; emits one preset JSON.
- Run, commit the JSON output, throw the script away.
- Old fused code still runs; new preset JSONs sit unused.
- **Verification:** for 3 sample templates (vintage, moody, teal_orange), spawn via old path and parse via new preset JSON — params match exactly.

### Commit 3 — Backend reads from registry (feature-flag)
- Add `propose_stack` MCP tool, with Phase 1 + Phase 2 wiring described in §5.
- Derive `RegistryToolDefaults` from the loader; keep `_LEGACY_TOOL_DEFAULTS` for fallback.
- Env flag `USE_REGISTRY_PLANNER=1` selects between old fused-template path and new planner for `mcp_user_prompt` and `mcp_autonomous` origins. Default off.
- `tool_invoked` origin always goes through `propose_stack` (with `forced_ops`) since it's the simplest case.
- Frontend `backendTools.propose_widget` still works (back-compat). Add `backendTools.propose_stack`.
- **Verification:** flag on locally — "vintage" prompt spawns 5 widgets. Flag off — old behavior intact.

### Commit 4 — Frontend control library + RegistryDrivenPanel
- Create `src/components/registry-controls/` with the 8 control components in §4.5.
- Create `<RegistryDrivenPanel op={op} />`.
- Inspector renders `RegistryDrivenPanel` when registry entry has `bindings`; falls back to bespoke `src/processing/*.tsx` Panel otherwise.
- **Verification:** open each tool's inspector under registry-driven mode. Controls visually and functionally match bespoke ones.

### Commit 5 — Cut over: registry is the only source
- Flip `USE_REGISTRY_PLANNER` to default on; delete the flag.
- Delete `backend/app/tools/fused/` (all 40+ files).
- Delete `backend/app/tools/tool_defaults.py`.
- Delete `shared/engine-registry.json`.
- Delete bespoke `src/processing/*.tsx` Panels (keep `index.ts` that registers from the registry).
- Remove `propose_widget` from the LLM tool manifest (stays as internal helper).
- **Verification:** vintage prompt → 5 widgets. Toolrail clicks still spawn single widgets. All 40+ presets nameable by the planner.

### Commit 6 — Multi-source preset loader (no UI yet)
- Loader reads from `shared/registry/presets/` + `~/.editor/presets/` + (placeholder) `.edp` project file.
- Each preset entry carries `source: "builtin" | "user" | "project"`.
- No save-preset UI. That belongs to a follow-up spec.
- **Verification:** drop a hand-authored JSON into `~/.editor/presets/`, planner sees it in the catalog.

### Risk gates

- Commits 1–4 are revertable in one step.
- Commit 5 is the cliff. A two-week soak period between commits 4 and 5 catches param drift.
- The fused → preset migration JSON is reviewable as one PR; any miscalibration is a one-file edit.

## 8. Testing strategy

### 8.1 Unit
- Registry schema validation: malformed op file rejected.
- Loader: missing required field, duplicate `id`, unknown `control_type` all error at startup.
- Preset unfolding: a preset with N ops produces N widgets with correct merged params.
- Param envelope clamping: out-of-range LLM response → clamped + retry counter increments.

### 8.2 Integration
- End-to-end "vintage" prompt: assert 5 widgets created, asserted op ids include `levels`, `color`, `hsl`, `splitTone`, `grain`.
- Toolrail click on Curves: 1 widget, correct registry defaults, no LLM call.
- Failure injection: Phase 1 returns malformed JSON → preset fallback fires.
- Failure injection: one Phase 2 op fails 3x → the rest still spawn, warning event emitted.

### 8.3 Visual regression
- For each of the 11 ops, render the same input image with the same params via old bespoke Panel and new `RegistryDrivenPanel`; compare screenshots.
- For each of 5 sampled presets (vintage, moody, teal_orange, golden_hour, dreamy), render canonical test image; compare against fused-template output from before commit 2.

### 8.4 Caching verification
- First call to planner: cache miss reported. Second call same session: persistent cache hit reported.

## 9. Open questions deferred to follow-up specs

1. **Save-preset UI** — how the user captures a great composition as a new preset, where it persists, how it shows up in the planner catalog. Architecture supports it; UX is its own spec.
2. **Catmull-rom curve editor and other richer controls** — the basic `CurveEditor` v1 is functional but minimal. Polish is a separate UI spec.
3. **Project-scoped presets in `.edp`** — loader hook is stubbed in Commit 6. The .edp embedding format is out of scope.
4. **Planner reasoning transparency** — the planner returns `overall_rationale` and per-op `rationale`. Whether the frontend shows them (e.g. on widget hover, in a "Why?" popover) is a UX decision for later.
5. **Multi-turn refinement** — user says "more grain, less warmth" → does the planner re-plan, or does the LLM call `propose_stack` again with `existing_widgets` context? Behavior is well-defined in §5.2 but the UX of multi-turn refinement deserves its own pass.

## 10. Definition of done

After commit 5 (commit 6 is additive):

- Typing *"make it look like a vintage film"* in Cmd+K spawns 5 distinct widgets on the canvas, each refineable.
- Adding a new tool (e.g. `bloom`) requires creating exactly one file: `shared/registry/ops/bloom.json`.
- Removing a tool requires deleting exactly one file plus its shader source.
- All 40+ ex-fused-template moods are still selectable by the planner (now via preset JSONs).
- `tool_invoked` clicks on the toolrail still spawn single widgets identically to today.
- No Python file under `backend/app/tools/fused/` exists.
- No `tool_defaults.py` exists.
- No `shared/engine-registry.json` exists.
- `src/processing/` contains only the registry wiring `index.ts` — no bespoke Panel files.
- The frontend control library renders all 11 ops' inspector Panels.

---

## Appendix A — Why these choices

**Why per-op JSON files instead of one mega file?** Reviewability and conflict avoidance. With 11 ops and 40+ presets, a single JSON pushes 2000+ lines and triggers merge conflicts on every parallel change. One file per op is the explicit "add/remove in one place" the user asked for.

**Why JSON instead of YAML or Python?** JSON is read by both stacks without parsing libraries, validates trivially against Pydantic on the backend and Zod/TS guards on the frontend, and is the lowest-common-denominator format for future external tooling (a preset marketplace, an export-from-Lightroom adapter, etc.).

**Why two-phase planner instead of single composite call?** Separation of concerns. Phase 1 is creative reasoning over a catalog (semantic, sparse output). Phase 2 is numerical reasoning over a typed schema with image context (dense output). Crushing both into one call means one giant response schema, no per-op caching, and a model that has to juggle creative composition and pixel-precise numbers in one head. Worse output, harder validation.

**Why keep presets at all?** Two pragmatic reasons: (1) warm-start consistency — your `vintage` should look like *your* vintage every time, not roll the dice on Opus's mood; (2) latency and token cost — composing 5 widgets from scratch costs more than picking a preset and tuning. Presets are optional: if the planner proves to compose well unaided, the JSONs can be deleted with zero behavior loss.

**Why one execution path through `propose_stack`?** The current code has three paths (Cmd+K, autonomous analyze, toolrail) that all call `propose_widget` differently. Unifying through `propose_stack({forced_ops: [...]})` collapses them into a single handler with three parameter modes — easier to reason about, easier to log, easier to evolve.
