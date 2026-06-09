# Bugfix Sweep — figma-scaling fallout + curves + filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five concrete bugs introduced by recent merges: crop tool reads display dims instead of source pixels, status pill has wrong min-width, AI-suggested curves don't render the canvas widget body, curves drag is broken in 2×2 / 4×1 layouts, and the Filters tool needs to be temporarily replaced with Presets.

**Architecture:** Each bug is independent and gets its own task. We use TDD where the bug is reproducible from a unit test (crop dims, AI curves recognition, curves drag). We use direct edit + manual verification where the bug is purely cosmetic / wiring (status pill width, Filters→Presets swap). Frequent commits, one per task.

**Tech Stack:** React 19, TypeScript strict, Vitest, Zustand, React Flow, Tailwind v4. Backend changes are out of scope — every fix is frontend-only.

---

## Bug Spec (current behavior vs. expected)

### Bug 1 — Crop tool reads display dimensions
**Where:** `src/components/inspector/crop/CropTab.tsx:72-74`, `:108`, `:121`, `:125`, `:201-202`.
**Now:** Reads `imageNode.size` (the canvas-space display box, defaults to 600px wide).
**Was (pre figma-scaling):** `size` held source pixel dims.
**Cause:** Commit e7aecca split `ImageNodeData` into `size` (display box) + `sourceSize` (source pixels). `CropTab` still reads the now-display field.
**Expected:** Crop uses `imageNode.sourceSize` everywhere — initial rect, `largestInsetRect`, preview scale, readout label.
**Hidden test gap:** `CropTab.test.tsx:26-30` seeds `size: {w: 800, h: 600}` matching the CanvasRegistry mock bitmap, masking the bug. Tests need `sourceSize` separated.

### Bug 2 — Status pill min-width
**Where:** `src/components/ui/BackendStatusBar.tsx` (the analyzing pill at lines ~95-115 and the strip pill at ~117-138).
**Now:** Pill width hugs its content. The cmd+K bar is 300px (`min-w-[300px]`), and suggestion pills now also 300px. The status pill looks narrower than the rest of the dock.
**Expected:** Both pill variants get `min-w-[300px]`, matching the rest of the dock.

### Bug 3 — AI-suggested curves don't render CurvesWidgetBody
**Where:** `src/components/widget/CurvesWidgetBody.tsx:35-42` (`isCurvesWidget` check).
**Now:** `isCurvesWidget` requires all four bindings `rgb`/`red`/`green`/`blue` with `control_type='curve_editor'`. Backend fused tools (e.g. `teal_orange`, `bw_cinematic`, `sky_recovery`) emit ONE binding with `param_key='points'` and `control_type='curve'` (single luma curve), so the predicate returns false and the widget falls back to generic `BindingRow` rendering with the plain `CurveControl` primitive — which works but doesn't look like the toolrail-spawned curves UI.
**Expected:** A single-curve (luma-only) AI-composed curves widget renders inside `CurvesWidgetBody`, locked to a one-editor toggle layout. The four-channel form continues to render with the layout switcher.

### Bug 4 — Curves drag broken in 2×2 and 4×1 layouts
**Where:** `src/components/inspector/widget/primitives/CurveEditor.tsx:48-122`.
**Now:** Drag handlers install on `document` via `useEffect`. With 4 `CurveEditor` instances mounted simultaneously (in `grid` / `stack` layouts of `CurvesWidgetBody`), all four register listeners; `points` changes on every mouseMove cause `useEffect` cleanup/re-register churn; no `setPointerCapture` means quick moves outside the small editor area can race with re-registration. Clicks register (mousedown is local), but drag never lands.
**Expected:** Drag works in all three layouts. Use pointer events with `setPointerCapture` on the editor SVG itself — each instance owns its own pointer stream, no document listeners, no re-registration churn.

### Bug 5 — Replace Filters with Presets in the Adjustments accordion
**Where:** `src/components/inspector/adjustments/AdjustmentsAccordion.tsx:29-35` (TOOL_GROUPS includes `['filter']`), `:18` (SECTION_LABELS has `filter: 'Filters'`); registrations at `src/App.tsx:25, 65` and `src/processing/index.ts:6, 21`.
**Now:** Filters appears as its own section in the inspector. Tool exists, processing registers a `filter` adjustment type. CLAUDE.md still describes filters as part of the 6-button toolrail (but the toolrail is registry-driven via `AdjustmentsAccordion`, not 6 hardcoded buttons).
**Expected:** Filters disappears from the UI temporarily — tool no longer registers, accordion no longer shows a Filters group. A new "Presets" group appears in the accordion, with one button per preset category that opens a popover/menu listing the presets in that category. Clicking a preset calls `spawnRegistryPreset(presetId, label)` (already exists). The Cmd+K palette's preset rows stay as-is. We do NOT delete the filter files (`src/tools/filters-tool.tsx`, `src/processing/filters.tsx`, the shader, the LUT registry) — they stay on disk for the "temporary" removal, just unregistered.

---

## File Structure

**Created:**
- `src/components/inspector/adjustments/PresetsSection.tsx` — replacement for the Filters group; renders one button per preset category, opening a popover with the presets.
- `src/components/inspector/adjustments/PresetsSection.test.tsx` — coverage for the popover wiring + spawn call.

**Modified:**
- `src/components/inspector/crop/CropTab.tsx` — read `sourceSize` instead of `size`.
- `src/components/inspector/crop/CropTab.test.tsx` — seed `sourceSize` in fixtures; add regression test for non-matching display vs source dims.
- `src/components/ui/BackendStatusBar.tsx` — `min-w-[300px]` on both pill variants.
- `src/components/widget/CurvesWidgetBody.tsx` — `isCurvesWidget` accepts the single-luma form; render a one-channel toggle layout when only one curve binding is present.
- `src/components/widget/CurvesWidgetBody.test.tsx` — coverage for the single-channel detection.
- `src/components/inspector/widget/primitives/CurveEditor.tsx` — replace document listeners with pointer-capture on the SVG.
- `src/components/inspector/widget/primitives/CurveEditor.test.tsx` (if absent, create) — drag test using synthetic pointer events.
- `src/components/inspector/adjustments/AdjustmentsAccordion.tsx` — swap `['filter']` for a Presets section; update `SECTION_LABELS`.
- `src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx` — update expectation from "Filters" → "Presets".
- `src/App.tsx` — drop `FiltersTool` import + registration.
- `src/processing/index.ts` — drop `filtersProcessing` import + registration.

---

## Task 1 — Status pill min-width (warm-up)

**Files:**
- Modify: `src/components/ui/BackendStatusBar.tsx:~100-138`

- [ ] **Step 1: Apply the min-width**

Open `src/components/ui/BackendStatusBar.tsx`. Both pill variants (`key="analyzing"` and `key="strip"`) need `min-w-[300px]` on the motion.div className. The cmd+K bar uses exactly this value, and so do the suggestion pills.

For the analyzing pill, change:
```tsx
className="overlay pointer-events-auto overflow-hidden
  backdrop-blur-md flex items-center"
```
to:
```tsx
className="overlay pointer-events-auto overflow-hidden
  backdrop-blur-md flex items-center min-w-[300px]"
```

For the strip pill, change:
```tsx
className="overlay pointer-events-auto overflow-hidden backdrop-blur-md"
```
to:
```tsx
className="overlay pointer-events-auto overflow-hidden backdrop-blur-md min-w-[300px]"
```

The `AnalyzingLine` div inside the analyzing pill should also stretch — wrap its content with `flex-1` on the existing `<span className="truncate max-w-[260px]">` parent so the spinner stays left and the "More info" button stays right. Specifically, change `AnalyzingLine`'s root div from `flex items-center gap-1.5 px-3 py-1.5 ...` to `flex items-center gap-1.5 px-3 py-1.5 w-full ...` and the text span to `flex-1 truncate`.

- [ ] **Step 2: Run typecheck + lint**

Run: `npx tsc -b && npx eslint src/components/ui/BackendStatusBar.tsx`
Expected: no output (clean).

- [ ] **Step 3: Manual verify (skip if no dev server handy — flag in commit)**

If running the dev server, trigger an analyze and confirm the status pill is the same width as the cmd+K bar below it. The pill's text should be left-aligned; "More info" should sit at the far right.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/BackendStatusBar.tsx
git commit -m "fix(dock): backend status pill matches cmd+K min-width (300px)"
```

---

## Task 2 — Filters → Presets in the Adjustments accordion

**Files:**
- Create: `src/components/inspector/adjustments/PresetsSection.tsx`
- Create: `src/components/inspector/adjustments/PresetsSection.test.tsx`
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.tsx:18, 29-35`
- Modify: `src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx:26-30`
- Modify: `src/App.tsx:25, 65`
- Modify: `src/processing/index.ts:6, 21`

- [ ] **Step 1: Write the failing test for PresetsSection**

Create `src/components/inspector/adjustments/PresetsSection.test.tsx`:

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/inspector/adjustments/PresetsSection.test.tsx`
Expected: FAIL — file `PresetsSection.tsx` does not exist.

- [ ] **Step 3: Implement PresetsSection**

Create `src/components/inspector/adjustments/PresetsSection.tsx`:

```tsx
import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { loadRegistry } from '@/lib/registry/loader';
import { spawnRegistryPreset } from '@/lib/toolrail-spawn';

/** Ordering matches command-palette.ts so the accordion and Cmd+K agree. */
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

interface PresetRow {
  id: string;
  display_name: string;
  description: string;
  category: string;
}

/** Inspector section that lists preset categories. Each category opens a
 *  popover with that category's presets; clicking a preset calls
 *  spawnRegistryPreset (same path Cmd+K uses). Replaces the temporarily
 *  removed Filters section. */
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
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="text-[11px] px-2 py-1 rounded-[var(--radius-button)]
            bg-surface border border-separator text-text-primary
            hover:bg-surface-secondary transition-colors"
        >
          {CATEGORY_LABELS[category] ?? category}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="overlay w-[260px] p-1 z-[60]"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <div className="flex flex-col">
            {items.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  spawnRegistryPreset(p.id, p.display_name);
                  setOpen(false);
                }}
                className="text-left px-2 py-1.5 rounded-[3px]
                  hover:bg-surface-secondary text-[11px]"
                title={p.description}
              >
                <div className="text-text-primary">{p.display_name}</div>
                <div className="text-[10px] text-text-secondary truncate">
                  {p.description}
                </div>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/inspector/adjustments/PresetsSection.test.tsx`
Expected: PASS — three tests green.

- [ ] **Step 5: Unregister Filters in App.tsx**

Open `src/App.tsx`. Find line `import { FiltersTool } from '@/tools/filters-tool';` (~line 25) and delete it. Find the `CanvasToolRegistry.register(FiltersTool)` call (~line 65) and delete that line. The other tool registrations stay.

- [ ] **Step 6: Unregister Filters in processing/index.ts**

Open `src/processing/index.ts`. Find `import { filtersProcessing } from './filters';` (~line 6) and delete it. Find `ProcessingRegistry.register(filtersProcessing)` (~line 21) and delete it.

- [ ] **Step 7: Replace `['filter']` group with Presets in AdjustmentsAccordion**

Open `src/components/inspector/adjustments/AdjustmentsAccordion.tsx`. At line ~18 (SECTION_LABELS), delete the `filter: 'Filters'` entry. At lines 29-35 (TOOL_GROUPS), delete the final `['filter']` entry. Then, in the section where TOOL_GROUPS rows render (search the file for `TOOL_GROUPS.map`), insert below the loop:

```tsx
<div className="border-t border-separator">
  <div className="text-[10px] uppercase tracking-wide text-text-secondary px-2 pt-2 pb-1">
    Presets
  </div>
  <PresetsSection />
</div>
```

Add the import at the top of the file:
```tsx
import { PresetsSection } from './PresetsSection';
```

- [ ] **Step 8: Update AdjustmentsAccordion.test.tsx**

Open `src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx` and find the assertion that expects "Filters" in the rendered output (around line 26-30 per the diagnosis). Replace the "Filters" expectation with a "Presets" expectation, e.g.:
```tsx
expect(screen.getByText('Presets')).toBeTruthy();
```
And drop any expectation that asserts "Filters" is present.

- [ ] **Step 9: Run typecheck + accordion tests**

Run: `npx tsc -b 2>&1 | grep -v "CurvesSectionBody\|BindingRow\|CompoundWidgetBody" && npx vitest run src/components/inspector/adjustments/`
Expected: typecheck clean, all accordion tests pass.

- [ ] **Step 10: Commit**

```bash
git add \
  src/components/inspector/adjustments/PresetsSection.tsx \
  src/components/inspector/adjustments/PresetsSection.test.tsx \
  src/components/inspector/adjustments/AdjustmentsAccordion.tsx \
  src/components/inspector/adjustments/AdjustmentsAccordion.test.tsx \
  src/App.tsx \
  src/processing/index.ts
git commit -m "feat(inspector): replace Filters group with Presets popover (temporary)"
```

---

## Task 3 — Crop tool reads sourceSize

**Files:**
- Modify: `src/components/inspector/crop/CropTab.tsx:72-74, 108, 121, 125, 201-202`
- Modify: `src/components/inspector/crop/CropTab.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Open `src/components/inspector/crop/CropTab.test.tsx`. Add a new test that seeds `size` and `sourceSize` to *different* values so the bug is unmaskable:

```tsx
it('initializes the crop rect to source pixel dims, not display dims', async () => {
  // 6000×4000 source image rendered at 600×400 display box — pre-fix code
  // initialized crop to {w: 600, h: 400}; the correct behavior is {w: 6000, h: 4000}.
  const id = 'img-1';
  useEditorStore.setState((s) => ({
    ...s,
    imageNodes: {
      [id]: {
        id,
        layerIds: ['L1'],
        position: { x: 0, y: 0 },
        size: { w: 600, h: 400 },
        sourceSize: { w: 6000, h: 4000 },
      },
    },
    activeImageNodeId: id,
  }));
  render(<CropTab />);
  // Readout should display the source dims; the visible label is "6000 × 4000 → ...".
  expect(await screen.findByText(/6000\s*×\s*4000/)).toBeTruthy();
});
```

If the test file already mocks `useEditorStore`, adapt the imports/setState calls to whatever the file already uses. Read the existing tests in `CropTab.test.tsx` first and mirror their setup style.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx`
Expected: FAIL — readout shows `600 × 400 → ...` instead of `6000 × 4000`.

- [ ] **Step 3: Replace size reads with sourceSize**

Open `src/components/inspector/crop/CropTab.tsx`. At lines 72-74, change:
```tsx
const imageNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
const sw = imageNode?.size.w ?? 0;
const sh = imageNode?.size.h ?? 0;
```
to:
```tsx
const imageNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
// Crop geometry is in *source pixel* coordinates — `size` is the canvas-space
// display box (introduced in figma-scaling), `sourceSize` is the natural bitmap.
const sw = imageNode?.sourceSize.w ?? 0;
const sh = imageNode?.sourceSize.h ?? 0;
```

Every downstream reference to `sw`/`sh` (lines 108, 121, 125, 201-202) is now correct because the variable names didn't change — only the source field did.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/inspector/crop/CropTab.test.tsx`
Expected: PASS, including the new test.

- [ ] **Step 5: Update existing test fixtures to seed both fields**

If any existing test in `CropTab.test.tsx` seeds `size` without `sourceSize`, add `sourceSize` to those fixtures using the same dims. This prevents flakes when the component reads `imageNode.sourceSize.w` instead of `imageNode.size.w`:

```tsx
// before
size: { w: 800, h: 600 },
// after
size: { w: 800, h: 600 },
sourceSize: { w: 800, h: 600 },
```

Run the full crop test file again to confirm.

Run: `npx vitest run src/components/inspector/crop/`
Expected: PASS (all crop tests green).

- [ ] **Step 6: Manual check (note in commit if skipped)**

If running the dev server, open a real photo (≠ 600px wide), enter crop mode, and confirm the readout shows the photo's source dims and the preview spans the full source on the first frame.

- [ ] **Step 7: Commit**

```bash
git add src/components/inspector/crop/CropTab.tsx src/components/inspector/crop/CropTab.test.tsx
git commit -m "fix(crop): use sourceSize, not display size, for crop geometry"
```

---

## Task 4 — AI-suggested curves widget recognition

**Files:**
- Modify: `src/components/widget/CurvesWidgetBody.tsx:24-42, ~140-175`
- Modify: `src/components/widget/CurvesWidgetBody.test.tsx`

- [ ] **Step 1: Write the failing test for single-channel detection**

Open `src/components/widget/CurvesWidgetBody.test.tsx` (or create it if absent — mirror the existing test file style). Add:

```tsx
import { describe, it, expect } from 'vitest';
import { isCurvesWidget } from './CurvesWidgetBody';

describe('isCurvesWidget', () => {
  it('detects the standard 4-channel form (toolrail-spawned)', () => {
    const w = {
      bindings: [
        { param_key: 'rgb',   control_type: 'curve_editor', value: [[0,0],[255,255]] },
        { param_key: 'red',   control_type: 'curve_editor', value: [[0,0],[255,255]] },
        { param_key: 'green', control_type: 'curve_editor', value: [[0,0],[255,255]] },
        { param_key: 'blue',  control_type: 'curve_editor', value: [[0,0],[255,255]] },
      ],
    };
    expect(isCurvesWidget(w as any)).toBe(true);
  });

  it('detects the single-luma form (AI fused tools)', () => {
    const w = {
      bindings: [
        { param_key: 'points', control_type: 'curve', value: [[0,0],[255,255]] },
      ],
    };
    expect(isCurvesWidget(w as any)).toBe(true);
  });

  it('rejects widgets with no curve bindings', () => {
    const w = {
      bindings: [
        { param_key: 'exposure', control_type: 'scalar', value: 0 },
      ],
    };
    expect(isCurvesWidget(w as any)).toBe(false);
  });
});
```

For this test to run, `isCurvesWidget` must be exported. If it's currently a non-exported helper inside `CurvesWidgetBody.tsx`, add `export` to its declaration.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/widget/CurvesWidgetBody.test.tsx`
Expected: FAIL — single-luma form returns `false`.

- [ ] **Step 3: Extend isCurvesWidget to accept the single-luma form**

Open `src/components/widget/CurvesWidgetBody.tsx`. The current check (around line 35-42) requires all four of `rgb`/`red`/`green`/`blue` with `control_type='curve_editor'`. Change it to also accept *exactly one* binding whose `control_type` is `'curve'` OR `'curve_editor'` and whose value is an `XYPair[]`. Replace the function with:

```tsx
const CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;
type Channel = (typeof CHANNELS)[number];

export function isCurvesWidget(widget: { bindings: WidgetBinding[] }): boolean {
  const bindings = widget.bindings ?? [];
  // Four-channel form (toolrail-spawned via curves.json registry op).
  const channels = new Set(
    bindings
      .filter((b) => b.control_type === 'curve_editor')
      .map((b) => b.param_key),
  );
  const fourChannel = CHANNELS.every((c) => channels.has(c));
  if (fourChannel) return true;
  // Single-luma form (AI fused tools — teal_orange, sky_recovery, …).
  const lumaOnly =
    bindings.length >= 1 &&
    bindings.filter(
      (b) => b.control_type === 'curve' || b.control_type === 'curve_editor',
    ).length === 1;
  return lumaOnly;
}
```

If `WidgetBinding` isn't imported here, add the import from wherever the widget types live (`@/types/widget` or similar — check the existing imports at the top of the file).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/widget/CurvesWidgetBody.test.tsx`
Expected: PASS — all three tests green.

- [ ] **Step 5: Render the single-luma form as a one-editor toggle layout**

Still in `CurvesWidgetBody.tsx`, find the layout-mode switcher / render block (around lines 140-175). When `isCurvesWidget` returns true but only ONE curve binding is present, we want to force the `toggle` layout and hide the layout switcher. Add a derived flag:

```tsx
const curveBindings = bindings.filter(
  (b) => b.control_type === 'curve' || b.control_type === 'curve_editor',
);
const singleLuma = curveBindings.length === 1;
const effectiveLayout = singleLuma ? 'toggle' : layout;
```

Replace every existing usage of `layout` in the JSX render block with `effectiveLayout`. Hide the layout switcher (`grid` / `stack` / `toggle` buttons) when `singleLuma` is true — wrap the switcher in `{!singleLuma && (...)}`.

In toggle mode, the active channel selector typically shows `rgb / red / green / blue`. When `singleLuma` is true, replace the four-tab selector with the single binding's `param_key` (e.g. "Curve"), and route reads/writes through that one binding.

If `ChannelEditor` is currently keyed by `Channel`, generalize it to take a `binding` prop directly. Alternatively, in the singleLuma branch render a `<CurveEditor>` directly with the single binding's value (`pairsToPoints(binding.value)`) and an `onChange` that writes back via `set_widget_param`.

(Implementation detail: look at how the existing `ChannelEditor` reads its binding and write a sibling component or extend it. Keep the existing 4-channel path untouched.)

- [ ] **Step 6: Add an integration-level test that the single-luma form renders a CurveEditor**

Append to `CurvesWidgetBody.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { CurvesWidgetBody } from './CurvesWidgetBody';

describe('CurvesWidgetBody single-luma rendering', () => {
  it('renders one CurveEditor when widget has a single curve binding', () => {
    const widget = {
      id: 'w1',
      bindings: [
        { param_key: 'points', control_type: 'curve', value: [[0,0],[128,128],[255,255]] },
      ],
    };
    render(<CurvesWidgetBody widget={widget as any} />);
    // CurveEditor renders an <svg role="img"> (adjust selector to match
    // the actual element if needed).
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    // The 2×2 and 4×1 layout buttons should NOT appear in single-luma mode.
    expect(screen.queryByRole('button', { name: /2.2|grid/i })).toBeNull();
  });
});
```

- [ ] **Step 7: Run all curves tests**

Run: `npx vitest run src/components/widget/CurvesWidgetBody.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/widget/CurvesWidgetBody.tsx src/components/widget/CurvesWidgetBody.test.tsx
git commit -m "fix(widget): single-luma curves (AI fused tools) render in CurvesWidgetBody"
```

---

## Task 5 — Curves drag works in 2×2 and 4×1 layouts

**Files:**
- Modify: `src/components/inspector/widget/primitives/CurveEditor.tsx:48-122`
- Create or modify: `src/components/inspector/widget/primitives/CurveEditor.test.tsx`

- [ ] **Step 1: Write the failing drag test**

Create (or extend) `src/components/inspector/widget/primitives/CurveEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CurveEditor } from './CurveEditor';

describe('CurveEditor drag (pointer events)', () => {
  it('moving the pointer after pointerdown updates the dragged point', () => {
    const onChange = vi.fn();
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ];
    const { container } = render(
      <CurveEditor points={points} onChange={onChange} width={200} height={200} />,
    );
    const svg = container.querySelector('svg')!;
    // Mock bounding rect so svgToPoint resolves the pointer to the middle point.
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => {} } as DOMRect);
    // setPointerCapture isn't implemented in jsdom — stub it.
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
    (svg as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();

    svg.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 80, pointerId: 1, bubbles: true }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 120, clientY: 80, pointerId: 1, bubbles: true }),
    );
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)![0];
    // The middle point's x should now be ~0.6 (120/200), y ~0.6 (1 - 80/200).
    const moved = lastCall[1];
    expect(moved.x).toBeCloseTo(0.6, 1);
    expect(moved.y).toBeCloseTo(0.6, 1);
  });

  it('two independent CurveEditor instances do not interfere', () => {
    const aChange = vi.fn();
    const bChange = vi.fn();
    const points = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    const { container } = render(
      <>
        <CurveEditor points={points} onChange={aChange} width={100} height={100} />
        <CurveEditor points={points} onChange={bChange} width={100} height={100} />
      </>,
    );
    const [svgA, svgB] = Array.from(container.querySelectorAll('svg'));
    svgA.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => {} } as DOMRect);
    svgB.getBoundingClientRect = () => ({ left: 200, top: 0, width: 100, height: 100, right: 300, bottom: 100, x: 200, y: 0, toJSON: () => {} } as DOMRect);
    (svgA as any).setPointerCapture = vi.fn();
    (svgB as any).setPointerCapture = vi.fn();
    (svgA as any).releasePointerCapture = vi.fn();
    (svgB as any).releasePointerCapture = vi.fn();

    // Drag in A only.
    svgA.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, pointerId: 1, bubbles: true }));
    svgA.dispatchEvent(new PointerEvent('pointermove', { clientX: 70, clientY: 30, pointerId: 1, bubbles: true }));
    svgA.dispatchEvent(new PointerEvent('pointerup',   { clientX: 70, clientY: 30, pointerId: 1, bubbles: true }));

    expect(aChange).toHaveBeenCalled();
    expect(bChange).not.toHaveBeenCalled();
  });
});
```

Adjust prop names (`points`, `onChange`, `width`, `height`) to match the actual `CurveEditor` API — read the existing component first and adapt.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/inspector/widget/primitives/CurveEditor.test.tsx`
Expected: FAIL — drag doesn't fire `onChange` (current document-listener implementation in jsdom doesn't bubble properly, AND/OR the second-instance test fails because both register document listeners).

- [ ] **Step 3: Refactor CurveEditor to use pointer events with capture**

Open `src/components/inspector/widget/primitives/CurveEditor.tsx`. Replace the `useEffect` document listener block (lines 91-122) and the `handleMouseDown` (lines 73-88) with pointer-event handlers attached to the SVG itself:

```tsx
const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
  const pt = svgToPoint(e.clientX, e.clientY);
  let idx = points.findIndex(
    (p) => Math.abs(p.x - pt.x) < 0.04 && Math.abs(p.y - pt.y) < 0.04,
  );
  if (idx < 0) {
    // Create a new point. Keep existing logic — copy it here from the
    // previous handleMouseDown's else-branch.
    const next = [...points, pt].sort((a, b) => a.x - b.x);
    idx = next.findIndex((p) => p.x === pt.x && p.y === pt.y);
    setChannelPoints(next);
  }
  draggingIdx.current = idx;
  // Capture the pointer to this SVG so subsequent pointermove/pointerup
  // events route here regardless of where the cursor goes — and other
  // CurveEditor instances see nothing.
  (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
};

const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
  if (draggingIdx.current === null) return;
  const pt = svgToPoint(e.clientX, e.clientY);
  const next = points.slice();
  next[draggingIdx.current] = pt;
  // Keep array sorted by x to preserve curve semantics; track the moved
  // point through the sort.
  next.sort((a, b) => a.x - b.x);
  draggingIdx.current = next.findIndex((p) => p === next[draggingIdx.current!]);
  setChannelPoints(next);
};

const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
  draggingIdx.current = null;
  try {
    (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
  } catch {
    // The browser releases capture automatically on pointerup; the explicit
    // call may throw if the capture was already released.
  }
};
```

In the JSX, attach the new handlers on the `<svg>` element:
```tsx
<svg
  ref={svgRef}
  onPointerDown={onPointerDown}
  onPointerMove={onPointerMove}
  onPointerUp={onPointerUp}
  onPointerCancel={onPointerUp}
  // ...existing props
>
```

Delete the old `useEffect` that installed `document.addEventListener('mousemove', ...)`. Delete the old `handleMouseDown` and `handleMouseUp` and any leftover `mousedown` JSX prop on the SVG.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/inspector/widget/primitives/CurveEditor.test.tsx`
Expected: PASS — both the drag-updates-point test and the two-instance isolation test.

- [ ] **Step 5: Run all curves-related tests as regression**

Run: `npx vitest run src/components/inspector/widget/primitives/ src/components/widget/CurvesWidgetBody.test.tsx src/components/inspector/adjustments/CurvesSectionBody.test.tsx`
Expected: PASS (all curves tests green).

- [ ] **Step 6: Manual check (note in commit if skipped)**

If the dev server is up, open a curves widget on the canvas, switch to 2×2 and 4×1 layouts, and confirm dragging a point in any channel works.

- [ ] **Step 7: Commit**

```bash
git add src/components/inspector/widget/primitives/CurveEditor.tsx src/components/inspector/widget/primitives/CurveEditor.test.tsx
git commit -m "fix(curves): pointer capture per editor — drag works in 2x2 + 4x1 layouts"
```

---

## Final verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc -b 2>&1 | tail -20`
Expected: only the pre-existing CurvesSectionBody / BindingRow / CompoundWidgetBody errors (unrelated to this plan). No new errors.

- [ ] **Step 2: Lint touched files**

Run:
```bash
npx eslint \
  src/components/inspector/crop/CropTab.tsx \
  src/components/ui/BackendStatusBar.tsx \
  src/components/widget/CurvesWidgetBody.tsx \
  src/components/inspector/widget/primitives/CurveEditor.tsx \
  src/components/inspector/adjustments/AdjustmentsAccordion.tsx \
  src/components/inspector/adjustments/PresetsSection.tsx \
  src/App.tsx \
  src/processing/index.ts
```
Expected: no output.

- [ ] **Step 3: Full test run**

Run: `npx vitest run`
Expected: PASS (only pre-existing failures unrelated to this plan).

- [ ] **Step 4: Manual smoke**

Open the dev server (if available). Verify:
- Status pill (analyze in flight) is the same width as cmd+K.
- Filters group is gone from inspector; Presets group present; clicking a category opens a popover; clicking a preset spawns it.
- Open a tall photo (e.g. 6000×4000), open Crop tab — readout shows 6000×4000.
- Trigger an AI fused tool (e.g. teal_orange) — Allow the widget — confirm a curves UI renders on the canvas (toggle layout, no layout switcher).
- Spawn a toolrail curves widget — switch to 2×2 and 4×1 layouts — drag points around in each channel — confirm drag works.

If any of the above fails, open an issue / file a follow-up — do NOT amend this plan's commits.

---

## Notes for the executor

- **No backwards-compat shims.** The split between `size` and `sourceSize` is the new doctrine; old test fixtures that only seeded `size` are bugs, not contracts. Update them.
- **Don't delete the filter files.** This task is "temporarily" removing Filters from the UI. `src/tools/filters-tool.tsx`, `src/processing/filters.tsx`, the LUT registry, and the shader stay on disk — they just stop registering. We can flip the switch back later by re-adding the two `register(...)` calls.
- **Pointer events, not mouse events.** Modern React supports pointer-event JSX props (`onPointerDown` etc.) — no need to call `addEventListener` manually for the new CurveEditor.
- **CurveEditor's existing behavior:** preserve the click-to-create-new-point behavior in `onPointerDown`'s else-branch. Copy the existing implementation from the old `handleMouseDown` if you need to — don't reinvent the math.
- **AI-curves single-luma:** the easiest mental model is "single binding, one editor, no layout switcher". Don't try to upgrade the AI side to four channels — that's a backend change out of this plan's scope.
