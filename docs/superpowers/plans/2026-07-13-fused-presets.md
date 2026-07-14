# Fused Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registry presets spawn as ONE fused intent widget (all ops, driver slider at 1.0) instead of N driverless single-op widgets; preset category chips in the inspector gain category-tinted swatch dots.

**Architecture:** `_handle_preset_spawn` in `propose_stack.py` is rewritten to call `_build_widget_multi` for all ops in one shot, then `_attach_fused_compound(..., force=True)`. The `exposed_param_keys` filtered path in `_build_widget` is removed (presets were the only caller). On the frontend, `PresetsSection.tsx` gains a small swatch dot per category chip and popover row using a local preset-vocabulary → strand-token mapping. `WidgetShell` already dispatches `FusedWidgetBody` for any widget with `.compound` regardless of origin — no frontend spawn changes needed.

**Tech Stack:** FastAPI/Pydantic Python backend, React 19 / TypeScript strict, Vitest, pytest-asyncio.

## Global Constraints

- TypeScript strict mode — no `any`, no `ts-ignore`.
- Lucide React: named imports only, never star-import.
- No hardcoded hex or px for design values — use `var(--token)` CSS custom properties.
- `npm run check` (tsc -b + eslint + no-nested-component) must pass green.
- Backend tests run via `cd backend && . .venv/bin/activate && python -m pytest <path> -q`.
- Commit on branch `feat/fused-presets` (already checked out).
- All new inline-defined functional components are forbidden (CLAUDE.md hard rule). Sub-components must be hoisted to module scope.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/tools/widgets/propose_stack.py` | Modify | Rewrite `_handle_preset_spawn`; remove `exposed_param_keys` path from `_build_widget` (and the parameter itself) |
| `backend/tests/registry/test_propose_stack.py` | Modify | Replace old per-op preset assertions with fused-widget assertions; keep `tone_red` 24-binding test |
| `src/components/inspector/adjustments/PresetsSection.tsx` | Modify | Add `PRESET_STRAND_TOKEN` map + swatch dot to category chip and popover row |
| `src/components/inspector/adjustments/PresetsSection.test.tsx` | Modify | Add swatch-dot assertions per category chip |
| `src/components/widget/FusedWidgetBody.test.tsx` | Modify | Add test: widget with `compound` + origin `tool_invoked` renders driver slider |

---

### Task 1: Rewrite `_handle_preset_spawn` — one fused widget per preset

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`

**Interfaces:**
- Consumes: `_build_widget_multi(widget_name, category, ops, intent, scope, origin, layer_id, image_node_layer_ids, doc)` — already exists in the same file.
- Consumes: `_attach_fused_compound(widget, doc, driver_label, force=True)` — already exists in the same file.
- Produces: `_Output(widgets=[...])` with exactly ONE widget per preset call.
- `_build_widget` signature change: `exposed_param_keys` parameter removed; the filtered-binding branch removed.

**Decision — `exposed_param_keys`:**
`grep` of the codebase shows `exposed_param_keys` is defined in `_build_widget` at line 332 and used only at line 684 inside `_handle_preset_spawn`. No other caller. The parameter and the filtered branch are dead after this task — remove both.

**Decision — `tone_red` / per-band presets:**
`tone_red.json` has a single op (`hsl`) with only `{red_hue, red_sat, red_lum}`. Under the new path, `_build_widget_multi` receives `params={"red_hue": -5, "red_sat": 12, "red_lum": 3}` (the preset's partial dict). The `_build_widget_multi` logic merges `full_params = {key: params[key] if key in params else canonical.get(key, p.default) ...}` — so ALL 24 HSL params end up in the node (other bands at defaults), and `pad_hsl_bindings` adds bindings for ALL 8 bands. The old `exposed_param_keys` filter that hid the other 21 bindings is GONE. **Acceptable**: the fused card's driver dial is the primary surface; the rich HSL body (revealed via expand) always shows all bands. State this clearly in the report.

- [ ] **Step 1: Confirm `exposed_param_keys` has no other callers**

```bash
grep -rn "exposed_param_keys" /Users/anton/Dev/Projects/editor/backend/ --include="*.py" | grep -v __pycache__
```

Expected output shows only lines 332, 338, 345, 392, 684 in `propose_stack.py`. No other file.

- [ ] **Step 2: Rewrite `_handle_preset_spawn` in `propose_stack.py`**

Replace lines 640–690 (the `_handle_preset_spawn` method) with:

```python
def _handle_preset_spawn(
    self, doc: SessionDocument, input: _Input, scope: Scope,
) -> _Output:
    """Unfold a named registry preset into ONE fused widget. No LLM call.

    All PresetOp entries become nodes in a single _build_widget_multi call,
    then _attach_fused_compound adds the synthesized driver (force=True to
    bypass the origin gate — the user chose a named preset, which implies
    the guided-dial experience). If synthesis declines (preset params all
    equal baseline), the widget ships driverless.

    Works for any origin (tool_invoked, mcp_user_prompt, mcp_autonomous).
    """
    assert input.preset_id is not None
    reg = get_registry()
    if input.preset_id not in reg.presets:
        raise ValueError(f"unknown preset id: {input.preset_id!r}")
    preset = reg.presets[input.preset_id]

    image_node_layer_ids = None
    if scope.root.kind == "image_node":
        image_node_layer_ids = list(scope.root.layer_ids)
    elif input.layer_ids:
        image_node_layer_ids = list(input.layer_ids)

    origin = WidgetOrigin(
        kind=input.origin,
        prompt=input.prompt or input.intent,
        parent_widget_id=None,
    )

    # Filter out any op_id not in the registry (safety net for stale presets).
    ops = [
        (p.op_id, p.params)
        for p in preset.ops
        if p.op_id in reg.ops
    ]
    if not ops:
        raise ValueError(f"preset {input.preset_id!r} has no valid ops in the registry")

    widget = _build_widget_multi(
        widget_name=preset.display_name,
        category=preset.category,
        ops=ops,
        intent=input.intent,
        scope=scope,
        origin=origin,
        layer_id=input.layer_id,
        image_node_layer_ids=image_node_layer_ids,
        doc=doc,
    )
    # force=True: bypass the origin gate so tool_invoked preset spawns also
    # receive the driver (user picked a named preset = guided-dial intent).
    _attach_fused_compound(widget, doc, driver_label=preset.display_name, force=True)
    doc.add_widget(widget)

    return _Output(widgets=[widget.model_dump(mode="json", by_alias=True)])
```

- [ ] **Step 3: Remove `exposed_param_keys` from `_build_widget`**

In `_build_widget` (lines 329–424), remove:
1. The `exposed_param_keys: set[str] | None = None,` parameter.
2. The docstring paragraph about `exposed_param_keys`.
3. The entire `if exposed_param_keys is None:` branch (lines 345–356) — keep the body (`return _build_widget_multi(...)`) and remove the `if` wrapper (make it unconditional).
4. Delete lines 358–424 (the filtered path: `# Param-filtered path...` through the final `return Widget(...)`).

The resulting `_build_widget` is now a thin wrapper that always calls `_build_widget_multi`. Its signature becomes:

```python
def _build_widget(
    *, op_id: str, params: dict, intent: str, scope: Scope,
    origin: WidgetOrigin, layer_id: str, image_node_layer_ids: list[str] | None,
    display_name: str | None = None, category: str | None = None,
    doc: "SessionDocument | None" = None,
) -> Widget:
    """Build a single-op widget. Thin wrapper around _build_widget_multi."""
    return _build_widget_multi(
        widget_name=display_name,
        category=category,
        ops=[(op_id, params)],
        intent=intent,
        scope=scope,
        origin=origin,
        layer_id=layer_id,
        image_node_layer_ids=image_node_layer_ids,
        doc=doc,
    )
```

- [ ] **Step 4: Run the backend test suite to see what breaks**

```bash
cd /Users/anton/Dev/Projects/editor/backend && . .venv/bin/activate && python -m pytest tests/registry/test_propose_stack.py -q 2>&1 | head -60
```

Expected: `test_preset_id_unfolds_into_widgets` FAILS (asserts `len >= 2` widgets; now 1), `test_preset_id_tone_red_binds_all_hsl_bands` may PASS (24 bindings still present via pad_hsl_bindings).

---

### Task 2: Update backend tests for the fused-preset shape

**Files:**
- Modify: `backend/tests/registry/test_propose_stack.py`

**Interfaces:**
- Consumes: `ProposeStackTool.handler` returning `_Output` with `.widgets` list.
- Widget dict fields: `opId`, `nodes`, `bindings`, `compound`, `driverValue`, `displayName`.

- [ ] **Step 1: Rewrite `test_preset_id_unfolds_into_widgets`**

Replace the test at line 176 with:

```python
@pytest.mark.asyncio
async def test_preset_id_unfolds_into_one_fused_widget(make_doc):
    """preset_id='vintage' must produce ONE fused widget with all its ops as nodes,
    a compound driver, and driverValue 1.0."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="vintage",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
        preset_id="vintage",
    ))
    # vintage has 3 ops → one widget with 3 nodes (levels, color, hsl)
    assert len(out.widgets) == 1
    w = out.widgets[0]
    # Display name from preset
    assert w["displayName"] == "Vintage"
    # One node per preset op
    node_op_ids = {n["opId"] for n in w["nodes"]}
    assert "levels" in node_op_ids
    assert "color" in node_op_ids
    assert "hsl" in node_op_ids
    # Fused compound block synthesized
    assert w["compound"] is not None
    assert w["driverValue"] == 1.0
    assert w["compound"]["label"] == "Vintage"
```

- [ ] **Step 2: Rewrite `test_preset_id_tone_red_binds_all_hsl_bands`**

The test already expects 24 bindings and one widget. Under the new code this still holds (single hsl op, pad_hsl_bindings pads to 24). The assertions remain correct. Update to also verify the fused compound:

```python
@pytest.mark.asyncio
async def test_preset_id_tone_red_spawns_fused_hsl_widget(make_doc):
    """tone_red spawns one fused hsl widget. All 24 HSL bands are bound so the
    frontend can reveal any of them via the HSL rich body. The driver synthesizes
    even with partial params (red_hue/sat/lum ≠ baseline → compound present)."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="HSL red",
        scope={"kind": "global"},
        origin="tool_invoked",
        preset_id="tone_red",
    ))
    assert len(out.widgets) == 1
    w = out.widgets[0]
    assert w["opId"] == "hsl"
    assert w["displayName"] == "Adjust red tones"
    # 24 bindings (all HSL bands via pad_hsl_bindings)
    binding_keys = {b["paramKey"] for b in w["bindings"]}
    assert len(binding_keys) == 24
    assert {"red_hue", "red_sat", "red_lum"} <= binding_keys
    assert {"blue_hue", "blue_lum", "magenta_sat"} <= binding_keys
    # Fused driver present because red params differ from baseline
    assert w["compound"] is not None
    assert w["driverValue"] == 1.0
```

- [ ] **Step 3: Add a test for multi-op preset with `tool_invoked` origin**

```python
@pytest.mark.asyncio
async def test_preset_id_tool_invoked_gets_fused_driver(make_doc):
    """tool_invoked origin must still produce a fused compound (force=True path)."""
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="golden hour",
        scope={"kind": "global"},
        origin="tool_invoked",
        preset_id="golden_hour",
    ))
    assert len(out.widgets) == 1
    w = out.widgets[0]
    # golden_hour has 3 ops: kelvin, light, color
    assert len(w["nodes"]) == 3
    # Fused driver despite tool_invoked origin
    assert w["compound"] is not None
    assert w["driverValue"] == 1.0
    assert w["compound"]["label"] == "Golden hour"
```

- [ ] **Step 4: Run the updated test file**

```bash
cd /Users/anton/Dev/Projects/editor/backend && . .venv/bin/activate && python -m pytest tests/registry/test_propose_stack.py -q
```

Expected: all tests PASS. If `test_preset_id_image_node_stamps_layer_ids` still passes (it expects exactly 1 widget from `tone_blue` which is also an hsl single-op preset), confirm the layer_ids assertion still holds.

- [ ] **Step 5: Run the full backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && . .venv/bin/activate && python -m pytest -q 2>&1 | tail -20
```

Expected: GREEN (no new failures). Pre-existing warnings are acceptable.

- [ ] **Step 6: Commit**

```bash
git add backend/app/tools/widgets/propose_stack.py backend/tests/registry/test_propose_stack.py
git commit -m "feat(presets): spawn as one fused driver widget via _build_widget_multi + force=True"
```

---

### Task 3: Frontend — restyle PresetsSection with category swatch dots

**Files:**
- Modify: `src/components/inspector/adjustments/PresetsSection.tsx`

**Design spec:**
- Swatch dot: 7×7px `rounded-sm` `inline-block`, `background: var(--strand-<token>)`, `data-strand-swatch="<category>"` attribute for test targeting.
- Preset vocabulary → strand token mapping (comment that these are preset categories, NOT op categories; nearest-family mapping):
  - `tone` → `--strand-tone`
  - `color` → `--strand-color`
  - `detail` → `--strand-detail`
  - `film` → `--strand-texture`
  - `mood` → `--strand-effect`
  - `bw` → `--strand-default`
  - `look` → `--strand-default`
- Category chip button: add the swatch dot before the label text, as a sibling `<span>` (not a component, to keep hoisting simple). The chip's existing border/hover/font classes remain unchanged.
- Popover rows: add the same swatch dot before the preset name `<div>`. Description `<div>` and truncation unchanged.

- [ ] **Step 1: Add `PRESET_STRAND_TOKEN` map and update the chip + row JSX**

The full updated `PresetsSection.tsx`:

```tsx
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { loadRegistry } from '@/lib/registry/loader';
import { spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { UI } from '@/config';

const PRESET_CATEGORY_ORDER = ['tone', 'color', 'bw', 'film', 'detail', 'mood', 'look'];

const CATEGORY_LABELS: Record<string, string> = {
  tone: 'Tone',
  color: 'Color',
  bw: 'B&W',
  film: 'Film',
  detail: 'Detail',
  mood: 'Mood',
  look: 'Looks',
};

/**
 * Preset category → strand token (CSS custom property name).
 *
 * IMPORTANT: preset categories (tone, color, bw, film, detail, mood, look)
 * are a DIFFERENT vocabulary from op categories (tone, color, detail, texture,
 * effect) defined in tether-strands.ts. This is a nearest-family mapping only.
 *   film  → --strand-texture  (film grain / texture family)
 *   mood  → --strand-effect   (creative-effect family)
 *   bw    → --strand-default  (no dedicated bw token)
 *   look  → --strand-default  (catch-all creative looks)
 */
const PRESET_STRAND_TOKEN: Record<string, string> = {
  tone:   '--strand-tone',
  color:  '--strand-color',
  detail: '--strand-detail',
  film:   '--strand-texture',
  mood:   '--strand-effect',
  bw:     '--strand-default',
  look:   '--strand-default',
};

function presetStrandVar(category: string): string {
  const token = PRESET_STRAND_TOKEN[category] ?? '--strand-default';
  return `var(${token})`;
}

interface PresetRow {
  id: string;
  display_name: string;
  description: string;
  category: string;
}

/** Inspector section that lists preset categories. Each category opens a
 *  popover with that category's presets; clicking a preset spawns it via
 *  the same helper Cmd+K uses. */
export function PresetsSection() {
  const grouped = useMemo(() => {
    const reg = loadRegistry();
    const byCat = new Map<string, PresetRow[]>();
    for (const [id, p] of Object.entries(reg.presets)) {
      const cat = p.category ?? 'look';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push({
        id,
        display_name: p.display_name,
        description: p.description,
        category: cat,
      });
    }
    const known = PRESET_CATEGORY_ORDER.filter((c) => byCat.has(c));
    const extra = [...byCat.keys()].filter((c) => !PRESET_CATEGORY_ORDER.includes(c)).sort();
    const ordered: { cat: string; items: PresetRow[] }[] = [];
    for (const cat of [...known, ...extra]) {
      const items = byCat.get(cat)!;
      items.sort((a, b) => a.display_name.localeCompare(b.display_name));
      ordered.push({ cat, items });
    }
    return ordered;
  }, []);

  return (
    <div className="flex flex-wrap gap-1.5 px-2 py-1.5">
      {grouped.map(({ cat, items }) => (
        <CategoryButton key={cat} category={cat} items={items} />
      ))}
    </div>
  );
}

function CategoryButton({ category, items }: { category: string; items: PresetRow[] }) {
  const [open, setOpen] = useState(false);
  const colorVar = presetStrandVar(category);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-[var(--radius-button)]
            bg-surface border border-separator text-text-primary
            hover:bg-surface-secondary transition-colors"
        >
          <span
            className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
            style={{ background: colorVar }}
            data-strand-swatch={category}
            aria-hidden
          />
          {CATEGORY_LABELS[category] ?? category}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-1"
          style={{ zIndex: UI.zPopover }}
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <div className="flex flex-col">
            {items.map((p) => (
              <PresetRowButton key={p.id} preset={p} onSelect={() => setOpen(false)} />
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PresetRowButton({ preset, onSelect }: { preset: PresetRow; onSelect: () => void }) {
  const colorVar = presetStrandVar(preset.category);
  return (
    <button
      type="button"
      onClick={() => {
        spawnRegistryPreset(preset.id, preset.display_name);
        onSelect();
      }}
      className="text-left px-2 py-1.5 rounded-[3px]
        hover:bg-surface-secondary text-[11px]"
      title={preset.description}
    >
      <div className="flex items-center gap-1 text-text-primary">
        <span
          className="inline-block w-[7px] h-[7px] rounded-sm flex-shrink-0"
          style={{ background: colorVar }}
          data-strand-swatch={preset.category}
          aria-hidden
        />
        {preset.display_name}
      </div>
      <div className="text-[10px] text-text-secondary truncate">
        {preset.description}
      </div>
    </button>
  );
}
```

Note: `PresetRowButton` is hoisted to module scope (not inline-defined inside `CategoryButton`) per the no-nested-component rule.

- [ ] **Step 2: Run `npm run check` to confirm no type errors**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check 2>&1 | tail -20
```

Expected: GREEN (0 errors). Pre-existing ESLint warnings are fine.

---

### Task 4: Update `PresetsSection.test.tsx` for swatch dots

**Files:**
- Modify: `src/components/inspector/adjustments/PresetsSection.test.tsx`

- [ ] **Step 1: Add swatch assertions to the existing tests**

The mock registry already has `golden_hour` (category: `tone`) and `teal_orange` (category: `look`). The chip for `tone` should contain a `[data-strand-swatch="tone"]` element; the chip for `look` contains `[data-strand-swatch="look"]`.

Replace the entire test file with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetsSection } from './PresetsSection';

vi.mock('@/lib/toolrail-spawn', () => ({
  spawnRegistryPreset: vi.fn(),
}));
vi.mock('@/lib/registry/loader', () => ({
  loadRegistry: () => ({
    ops: {},
    presets: {
      golden_hour: {
        id: 'golden_hour',
        display_name: 'Golden Hour',
        description: 'Warm sunset grade',
        category: 'tone',
        icon: 'wb_sunny',
      },
      cool_grade: {
        id: 'cool_grade',
        display_name: 'Cool Grade',
        description: 'Cyan-blue cast',
        category: 'tone',
        icon: 'ac_unit',
      },
      teal_orange: {
        id: 'teal_orange',
        display_name: 'Teal & Orange',
        description: 'Cinematic split-tone',
        category: 'look',
        icon: 'movie',
      },
    },
  }),
}));

import { spawnRegistryPreset } from '@/lib/toolrail-spawn';

describe('PresetsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one button per preset category', () => {
    render(<PresetsSection />);
    expect(screen.getByRole('button', { name: /tone/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /look/i })).toBeTruthy();
  });

  it('opens a popover listing presets in the clicked category', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    expect(screen.getByText('Golden Hour')).toBeTruthy();
    expect(screen.getByText('Cool Grade')).toBeTruthy();
  });

  it('spawning a preset calls spawnRegistryPreset with the preset id + display name', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    fireEvent.click(screen.getByText('Golden Hour'));
    expect(spawnRegistryPreset).toHaveBeenCalledWith('golden_hour', 'Golden Hour');
  });

  it('tone category chip contains a swatch dot with data-strand-swatch="tone"', () => {
    const { container } = render(<PresetsSection />);
    // The chip button's accessible name includes "Tone"; find it and check for swatch.
    const toneChip = screen.getByRole('button', { name: /tone/i });
    const swatch = toneChip.querySelector('[data-strand-swatch="tone"]');
    expect(swatch).not.toBeNull();
  });

  it('look category chip contains a swatch dot with data-strand-swatch="look"', () => {
    render(<PresetsSection />);
    const lookChip = screen.getByRole('button', { name: /look/i });
    const swatch = lookChip.querySelector('[data-strand-swatch="look"]');
    expect(swatch).not.toBeNull();
  });

  it('tone swatch dot uses the --strand-tone CSS variable', () => {
    render(<PresetsSection />);
    const toneChip = screen.getByRole('button', { name: /tone/i });
    const swatch = toneChip.querySelector('[data-strand-swatch="tone"]') as HTMLElement;
    expect(swatch.style.background).toMatch(/var\(--strand-tone\)/);
  });

  it('look swatch dot uses --strand-default CSS variable (no dedicated look token)', () => {
    render(<PresetsSection />);
    const lookChip = screen.getByRole('button', { name: /look/i });
    const swatch = lookChip.querySelector('[data-strand-swatch="look"]') as HTMLElement;
    expect(swatch.style.background).toMatch(/var\(--strand-default\)/);
  });

  it('popover preset rows contain swatch dots after opening the category', () => {
    const { container } = render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    // After opening, there should be swatch dots inside the popover rows.
    // The mock has 2 tone presets; we expect 2 row swatches in the portal.
    const swatches = document.querySelectorAll('[data-strand-swatch="tone"]');
    // At least 2: one in the chip, two in the popover rows = 3 total.
    expect(swatches.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the updated PresetsSection tests**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/inspector/adjustments/PresetsSection.test.tsx 2>&1 | tail -20
```

Expected: all tests PASS.

---

### Task 5: Frontend verification test — `tool_invoked` preset widget renders FusedWidgetBody

**Files:**
- Modify: `src/components/widget/FusedWidgetBody.test.tsx`

**Context:** `WidgetShell` dispatches `FusedWidgetBody` when `!!widget.compound` (line 94, `isFused`). `showAiAffordances = widget.origin.kind !== 'tool_invoked'` is used only for the violet border class and header affordances — NOT for the `isFused` check. So a `tool_invoked` widget with `compound` does reach `FusedWidgetBody`. We add an explicit test that guards this invariant.

`makeAiWidget` in `__fixtures__/widgets.ts` is used by the existing tests; it defaults to `mcp_user_prompt` origin. We need a `tool_invoked` variant.

- [ ] **Step 1: Add the test to `FusedWidgetBody.test.tsx`**

Add the following test inside the top-level `describe('FusedWidgetBody', ...)` block, after the existing tests (before the closing `}`):

```tsx
it('tool_invoked origin preset widget still renders the driver slider (isFused is compound-gated)', () => {
  // Simulate a preset-spawned widget: origin=tool_invoked, but compound present.
  // WidgetShell dispatches FusedWidgetBody for any widget with !!widget.compound,
  // regardless of origin. This test guards that FusedWidgetBody itself does not
  // accidentally check origin.kind before rendering the driver.
  const widget = makeFusedWidget({
    origin: {
      kind: 'tool_invoked',
      prompt: null,
      parentWidgetId: null,
    },
    compound: {
      driver: '__driver',
      label: 'Golden hour',
      anchors: [
        { position: 0, name: 'as shot',  values: { 'n-basic-1:exposure': 0 } },
        { position: 1, name: 'proposed', values: { 'n-basic-1:exposure': 50 } },
      ],
    },
    driverValue: 1.0,
  });
  const { getByRole } = render(
    <ReactFlowProvider>
      <FusedWidgetBody
        widget={widget}
        effectiveValue={(b) => b.value as number}
        setParam={vi.fn()}
      />
    </ReactFlowProvider>,
  );
  // The driver slider must be present (label from compound.label = 'Golden hour').
  expect(getByRole('slider', { name: /golden hour/i })).toBeTruthy();
});
```

- [ ] **Step 2: Check `Widget` type for `origin` shape**

Before committing verify the `Widget` type's `origin` field shape by grepping:

```bash
grep -n "origin" /Users/anton/Dev/Projects/editor/src/types/widget.ts | head -20
```

The origin shape is `{ kind: WidgetOriginKind; prompt: string | null; parentWidgetId: string | null }`. Confirm `WidgetOriginKind` includes `'tool_invoked'`. If the type is imported, use the matching literal.

- [ ] **Step 3: Run the FusedWidgetBody tests**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/components/widget/FusedWidgetBody.test.tsx 2>&1 | tail -20
```

Expected: all tests PASS including the new one.

---

### Task 6: Full suite + final commit

**Files:**
- None new; runs existing code.

- [ ] **Step 1: Run the complete frontend check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check 2>&1 | tail -30
```

Expected: 0 type errors. Pre-existing lint warnings acceptable.

- [ ] **Step 2: Run the full frontend test suite**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 3: Run the complete backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && . .venv/bin/activate && python -m pytest -q 2>&1 | tail -20
```

Expected: GREEN.

- [ ] **Step 4: Write the report**

Create `/Users/anton/Dev/Projects/editor/.superpowers/sdd/fused-presets-report.md` with:

```markdown
# Fused Presets — Implementation Report

## exposed_param_keys decision
`exposed_param_keys` was the only caller-site used by `_handle_preset_spawn` in `propose_stack.py`.
Grep confirmed no other callers in the backend. The parameter and the entire filtered-binding branch
have been removed from `_build_widget`. The function is now a thin unconditional wrapper around
`_build_widget_multi`.

## tone_red / per-band preset behaviour change
Previously `tone_red` (and other per-band presets like tone_blue, tone_green, etc.) exposed ONLY the
preset's baked params as bindings (e.g. red_hue, red_sat, red_lum = 3 bindings). Under the new path,
`_build_widget_multi` receives those 3 params and merges all 24 HSL params (others at defaults).
`pad_hsl_bindings` still adds ALL 24 band bindings. The fused compound dial is now the primary surface;
the rich HSL body (expand to reveal) always shows all bands. Acceptable — the "+ add colour" affordance
was already designed around all bands being bound; the dial experience is now the primary surface.

## Category mapping
Preset categories (tone, color, bw, film, detail, mood, look) are a DIFFERENT vocabulary from op
categories (tone, color, detail, texture, effect). The `PRESET_STRAND_TOKEN` map in PresetsSection.tsx
uses a nearest-family approximation:
- film → --strand-texture (film grain lives in the texture family)
- mood → --strand-effect (creative-effect family)
- bw, look → --strand-default (no dedicated tokens; catch-all)
This mapping is defined LOCAL to PresetsSection.tsx with a clear comment; it does NOT modify
tether-strands.ts which maps op categories for the canvas tether strands.

## WidgetShell origin interaction
`WidgetShell.tsx` line 90: `showAiAffordances = widget.origin.kind !== 'tool_invoked'`.
This gate controls: violet border class (`widget-shell-ai`), header affordances (refine, why).
It does NOT gate the `isFused` check (line 94: `const isFused = !!widget.compound`).
So a `tool_invoked` preset widget with `compound` gets `FusedWidgetBody` — the driver renders.
The only visual difference from an AI-originated widget: no violet border, no refine/why buttons.
Test in FusedWidgetBody.test.tsx guards this invariant explicitly.

## Suite results
- Backend: PASS (see commit)
- Frontend `npm run check`: PASS
- Frontend `npx vitest run`: PASS
```

- [ ] **Step 5: Stage and commit everything**

```bash
cd /Users/anton/Dev/Projects/editor && git add \
  backend/app/tools/widgets/propose_stack.py \
  backend/tests/registry/test_propose_stack.py \
  src/components/inspector/adjustments/PresetsSection.tsx \
  src/components/inspector/adjustments/PresetsSection.test.tsx \
  src/components/widget/FusedWidgetBody.test.tsx \
  .superpowers/sdd/fused-presets-report.md
git commit -m "feat(presets): spawn as fused driver widgets + category-tinted preset chips"
```

Verify the commit is on `feat/fused-presets`:

```bash
git log --oneline -3
git branch --show-current
```

Expected: branch = `feat/fused-presets`, commit appears at top.
