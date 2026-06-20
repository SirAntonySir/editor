# H25 — Widget/Inspector Primitive Boundary Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `src/components/widget/*` from importing out of `src/components/inspector/*`. CLAUDE.md says cross-domain primitives belong in `ui/`; topic-local sub-components stay in their topic folder.

**Architecture:** Each primitive flagged as a cross-boundary import is independently moved to its correct home — `ui/` when truly atomic/presentational, the more-central topic folder when it carries domain logic. Imports across the codebase are updated en masse per primitive. One commit per primitive so any regressions bisect cleanly.

**Tech Stack:** React 19, TypeScript strict, Vite path aliases (`@/components/ui/*`, `@/components/inspector/*`, `@/components/widget/*`).

**Audit reference:** `docs/audit-2026-06-15.md`, H25.

---

## The actual offenders (verified by grep)

These files in `src/components/widget/` import from `src/components/inspector/`:

| Importer (widget/) | Imported from inspector/ |
|---|---|
| `WidgetShell.tsx` | `BindingRow` |
| `HslWidgetBody.tsx` | `AdjustmentSlider`, `HslPanelView`, `HslSingleBandView` |
| `CurvesWidgetBody.tsx` | `CurveEditor` (the `inspector/widget/primitives/CurveEditor.tsx` one) |
| `InfoWidgetShell.tsx` | `MetricChip`, `MetricChipGrid` |
| `LevelsWidgetBody.tsx` | `AdjustmentSlider`, `LevelsHistogramControl` |

The rule (CLAUDE.md, "Component Architecture (strict)"):
> Cross-domain primitives (used by ≥2 topic folders) belong in `ui/`. Topic-local sub-components stay in their topic folder.

## Per-primitive verdict + rationale

Each primitive's verdict is based on the grep results below. The implementer should re-verify per task before moving.

| Primitive | Current home | Verdict | Why |
|---|---|---|---|
| `AdjustmentSlider` | `inspector/AdjustmentSlider.tsx` | **Move to `ui/AdjustmentSlider.tsx`** | Used by 6+ inspector files, 2 widget files, 1 processing file. Atomic presentational slider — textbook `ui/` candidate. |
| `MetricChip` + `MetricChipGrid` | `inspector/info/MetricChip.tsx` | **Move to `ui/MetricChip.tsx`** | Used by widget/InfoWidgetShell + 3 inspector/info files. Stateless display component. |
| `LevelsHistogramControl` | `inspector/LevelsHistogramControl.tsx` | **Move to `ui/LevelsHistogramControl.tsx`** | Used by 1 widget file, 2 inspector files, 1 processing file. Self-contained histogram + endpoint controls. |
| `CurveEditor` (the one at `inspector/widget/primitives/CurveEditor.tsx`) | `inspector/widget/primitives/` | **Move to `ui/CurveEditor.tsx`** | Used by widget/CurvesWidgetBody, inspector/widget/BindingRow, CurveControl, CurvesSectionBody. The path `inspector/widget/primitives/` already concedes it's a primitive — the folder name is just hiding. Note: there's a separate `registry-controls/CurveEditor.tsx` — leave that alone, it's a different component. |
| `BindingRow` | `inspector/widget/BindingRow.tsx` | **Move to `widget/BindingRow.tsx`** | The name says "binding *for a widget*". Used by widget/WidgetShell + widget/LevelsWidgetBody + inspector/adjustments/AiSection + inspector/widget/BindingRow (its own file). The widget side is the dominant consumer and the natural home; inspector becomes the importer. |
| `HslPanelView` + `HslSingleBandView` | `inspector/adjustments/` | **Move to `widget/hsl/HslPanelView.tsx` + `widget/hsl/HslSingleBandView.tsx`** | Used by widget/HslWidgetBody + inspector/adjustments/HslSectionBody (and HslSingleBandView by HslPanelView itself). HSL widget body composes them; inspector body delegates to the widget body's primitives. Widget is the home, inspector imports back. |

After this is done, the dependency direction is: `inspector/ → widget/` and both `→ ui/`. `widget/` does NOT import from `inspector/`. That's the rule.

---

## File structure (final layout)

```
src/components/
  ui/
    AdjustmentSlider.tsx          (moved from inspector/)
    MetricChip.tsx                (moved from inspector/info/)
    LevelsHistogramControl.tsx    (moved from inspector/)
    CurveEditor.tsx               (moved from inspector/widget/primitives/)
  widget/
    BindingRow.tsx                (moved from inspector/widget/)
    hsl/
      HslPanelView.tsx            (moved from inspector/adjustments/)
      HslSingleBandView.tsx       (moved from inspector/adjustments/)
    …existing files…
  inspector/
    …existing files (minus the six listed above)…
```

Test files move with their components.

---

## Task 1: Move `AdjustmentSlider` to `ui/`

**Files:**
- Move: `src/components/inspector/AdjustmentSlider.tsx` → `src/components/ui/AdjustmentSlider.tsx`
- Move: `src/components/inspector/AdjustmentSlider.test.tsx` → `src/components/ui/AdjustmentSlider.test.tsx` (if it exists)
- Update import paths in every consumer.

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "AdjustmentSlider" src/ --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | sort
```

Expected output (today): the six consumer files + the component itself. Note the exact paths.

- [ ] **Step 2: Move the file**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/AdjustmentSlider.tsx src/components/ui/AdjustmentSlider.tsx
# If a test file exists:
git mv src/components/inspector/AdjustmentSlider.test.tsx src/components/ui/AdjustmentSlider.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Update imports in every consumer**

For each file from Step 1, change `from '@/components/inspector/AdjustmentSlider'` to `from '@/components/ui/AdjustmentSlider'`. Use Edit per file. The exact import path may also be relative — normalise everything to the `@/components/ui/AdjustmentSlider` alias.

Specifically (verify these are current; grep results above):
- `src/processing/levels.tsx`
- `src/components/widget/LevelsWidgetBody.tsx`
- `src/components/inspector/LevelsHistogramControl.tsx`
- `src/components/inspector/adjustments/HslParamSlider.tsx`
- `src/components/widget/HslWidgetBody.tsx`
- `src/components/inspector/adjustments/ScalarSectionBody.tsx`
- `src/components/inspector/adjustments/LevelsSectionBody.tsx`
- `src/components/inspector/LayerProperties.tsx`
- `src/components/inspector/widget/BindingRow.tsx`

- [ ] **Step 4: Inside the moved file, fix any same-folder relative imports**

```bash
cd /Users/anton/Dev/Projects/editor && grep -n "from '\.\.?/'" src/components/ui/AdjustmentSlider.tsx || echo "no relative imports"
```

If relative imports exist, swap them for `@/` aliases (e.g. `./Foo` → `@/components/inspector/Foo` when Foo did NOT move). Inspector-side imports are still allowed *from* `ui/` — wait, no: `ui/` is the leaf. Cross-import into `inspector/` from inside a `ui/` file would re-create the cycle. If you find a same-folder import in `AdjustmentSlider.tsx` that pointed to another inspector file (e.g., a numeric formatter), the right fix is usually to (a) inline the tiny dependency, or (b) move that helper to `lib/`, or (c) stop and flag the dependency in your report so we can plan it separately.

- [ ] **Step 5: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. All 773+ tests still pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui): move AdjustmentSlider from inspector/ to ui/

Atomic presentational slider used by both inspector/ and widget/ topic
folders. Per CLAUDE.md, cross-domain primitives belong in ui/.

Audit follow-up — H25 (slice 1/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Move `MetricChip` + `MetricChipGrid` to `ui/`

**Files:**
- Move: `src/components/inspector/info/MetricChip.tsx` → `src/components/ui/MetricChip.tsx`
- Move: any test file alongside it.
- Update import paths.

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "MetricChip\b\|MetricChipGrid\b" src/ --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | sort
```

Note: both symbols come from the same file, so one move covers both.

- [ ] **Step 2: Move the file**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/info/MetricChip.tsx src/components/ui/MetricChip.tsx
# Tests if present:
git mv src/components/inspector/info/MetricChip.test.tsx src/components/ui/MetricChip.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Update imports**

For each consumer (verify from Step 1):
- `src/components/widget/InfoWidgetShell.tsx`
- `src/components/inspector/info/MetadataSection.tsx`
- `src/components/inspector/info/MetricChipMenu.tsx`
- `src/components/inspector/info/HistogramsSection.tsx`

Change `from '@/components/inspector/info/MetricChip'` → `from '@/components/ui/MetricChip'`.

- [ ] **Step 4: Fix same-folder relative imports in the moved file (if any)**

Same procedure as Task 1, Step 4.

- [ ] **Step 5: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui): move MetricChip + MetricChipGrid from inspector/info/ to ui/

Stateless display chips used by widget/InfoWidgetShell and three
inspector/info consumers. Cross-domain primitive → ui/.

Audit follow-up — H25 (slice 2/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Move `LevelsHistogramControl` to `ui/`

**Files:**
- Move: `src/components/inspector/LevelsHistogramControl.tsx` → `src/components/ui/LevelsHistogramControl.tsx`
- Update import paths.

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "LevelsHistogramControl" src/ --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | sort
```

- [ ] **Step 2: Move the file**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/LevelsHistogramControl.tsx src/components/ui/LevelsHistogramControl.tsx
git mv src/components/inspector/LevelsHistogramControl.test.tsx src/components/ui/LevelsHistogramControl.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Update imports in each consumer (verify)**

- `src/components/ui/HistogramPlot.tsx` — wait, this is the consumer order shown by grep. If `ui/HistogramPlot` is consuming `inspector/LevelsHistogramControl`, that's a pre-existing breach in the opposite direction that this move actually FIXES. Note in commit message.
- `src/components/widget/LevelsWidgetBody.tsx`
- `src/processing/levels.tsx`
- `src/components/inspector/adjustments/LevelsSectionBody.tsx`

Change `from '@/components/inspector/LevelsHistogramControl'` → `from '@/components/ui/LevelsHistogramControl'`.

- [ ] **Step 4: Fix the moved file's own internal imports**

In `src/components/ui/LevelsHistogramControl.tsx`, after move, swap `from '@/components/ui/AdjustmentSlider'` (already done in Task 1, so check it's correct) and any other relative imports.

- [ ] **Step 5: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui): move LevelsHistogramControl from inspector/ to ui/

Self-contained histogram + endpoint controls used by widget/, inspector/,
and processing/. Cross-domain primitive → ui/. Also resolves a
ui/→inspector/ import chain via HistogramPlot.

Audit follow-up — H25 (slice 3/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Move `CurveEditor` (the widget-primitives one) to `ui/`

**Files:**
- Move: `src/components/inspector/widget/primitives/CurveEditor.tsx` → `src/components/ui/CurveEditor.tsx`
- Update import paths.

**Important:** There is a SEPARATE component at `src/components/registry-controls/CurveEditor.tsx`. Do NOT touch it. This task only moves `inspector/widget/primitives/CurveEditor.tsx`.

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "from '@/components/inspector/widget/primitives/CurveEditor'" src/ --include='*.tsx' --include='*.ts' | sort
```

Verify exact import path style.

- [ ] **Step 2: Move the file (+ test if present)**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/widget/primitives/CurveEditor.tsx src/components/ui/CurveEditor.tsx
git mv src/components/inspector/widget/primitives/CurveEditor.test.tsx src/components/ui/CurveEditor.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Update imports**

Expected consumers (verify):
- `src/components/inspector/widget/BindingRow.tsx`
- `src/components/inspector/widget/primitives/CurveControl.tsx`
- `src/components/widget/CurvesWidgetBody.tsx`
- `src/components/inspector/adjustments/CurvesSectionBody.tsx`

Change `from '@/components/inspector/widget/primitives/CurveEditor'` → `from '@/components/ui/CurveEditor'`.

- [ ] **Step 4: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. Tests for the two `CurveEditor` components (the moved one and `registry-controls/CurveEditor`) both still pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ui): move CurveEditor primitive from inspector/widget/primitives/ to ui/

The "primitive" curve editor was already conceptually a primitive (the
folder name conceded it). Used by both inspector/ and widget/, so it
lives in ui/. The separate registry-controls/CurveEditor is unchanged.

Audit follow-up — H25 (slice 4/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Move `BindingRow` from `inspector/widget/` to `widget/`

**Files:**
- Move: `src/components/inspector/widget/BindingRow.tsx` → `src/components/widget/BindingRow.tsx`
- Update import paths.

Rationale: name says "binding [for a] widget"; widget is the dominant consumer; inspector becomes the importer (allowed direction).

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "BindingRow" src/ --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | sort
```

Expected:
- `src/components/widget/WidgetShell.tsx`
- `src/components/widget/LevelsWidgetBody.tsx`
- `src/components/inspector/widget/BindingRow.tsx` (the source)
- `src/components/inspector/adjustments/AiSection.tsx`
- `src/store/tool-slice.ts` (verify whether this references the symbol name or a string)

- [ ] **Step 2: Move the file**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/widget/BindingRow.tsx src/components/widget/BindingRow.tsx
git mv src/components/inspector/widget/BindingRow.test.tsx src/components/widget/BindingRow.test.tsx 2>/dev/null || true
```

- [ ] **Step 3: Update imports**

Change `from '@/components/inspector/widget/BindingRow'` → `from '@/components/widget/BindingRow'` in:
- `src/components/widget/WidgetShell.tsx`
- `src/components/widget/LevelsWidgetBody.tsx`
- `src/components/inspector/adjustments/AiSection.tsx`

For `src/store/tool-slice.ts`, check whether it imports the component or just references the string `'BindingRow'`. If it's the latter, no change. If it's the former, update.

- [ ] **Step 4: Fix the moved file's internal imports**

Since `BindingRow.tsx` lives in `widget/` now, its imports from `inspector/` (if any beyond the primitives we've already moved) become a NEW breach. Inspect:

```bash
cd /Users/anton/Dev/Projects/editor && grep -n "from '@/components/inspector" src/components/widget/BindingRow.tsx || echo "no inspector imports"
```

If any inspector imports remain, identify them. They likely fall in one of three buckets:
- Helper functions only (e.g., a `formatX`) — move them to `src/lib/` and update imports.
- Type-only imports — change to `import type { … }` if not already, and consider moving the type to `src/types/`.
- Component imports — flag as a separate follow-up; do not silently re-introduce a topic-folder breach.

- [ ] **Step 5: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(widget): move BindingRow from inspector/widget/ to widget/

Reverses the dependency direction: widget/ no longer imports from
inspector/ for BindingRow. Inspector consumers (AiSection) now import
from widget/ — that direction is allowed.

Audit follow-up — H25 (slice 5/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Move `HslPanelView` + `HslSingleBandView` from `inspector/adjustments/` to `widget/hsl/`

**Files:**
- Create directory: `src/components/widget/hsl/`
- Move: `src/components/inspector/adjustments/HslPanelView.tsx` → `src/components/widget/hsl/HslPanelView.tsx`
- Move: `src/components/inspector/adjustments/HslSingleBandView.tsx` → `src/components/widget/hsl/HslSingleBandView.tsx`
- Move associated tests.
- Update import paths.

Rationale: widget body uses them as core widget primitives; inspector body delegates to the widget body's primitives.

- [ ] **Step 1: Confirm consumers**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "HslPanelView\|HslSingleBandView" src/ --include='*.tsx' --include='*.ts' | grep -v '\.test\.' | sort
```

Expected:
- `src/components/widget/HslWidgetBody.tsx`
- `src/components/inspector/adjustments/HslSectionBody.tsx`
- `src/components/inspector/adjustments/HslPanelView.tsx` (source)
- `src/components/inspector/adjustments/HslSingleBandView.tsx` (source, also imports HslPanelView)

- [ ] **Step 2: Make the destination folder**

```bash
mkdir -p /Users/anton/Dev/Projects/editor/src/components/widget/hsl
```

- [ ] **Step 3: Move the files**

```bash
cd /Users/anton/Dev/Projects/editor
git mv src/components/inspector/adjustments/HslPanelView.tsx src/components/widget/hsl/HslPanelView.tsx
git mv src/components/inspector/adjustments/HslSingleBandView.tsx src/components/widget/hsl/HslSingleBandView.tsx
git mv src/components/inspector/adjustments/HslPanelView.test.tsx src/components/widget/hsl/HslPanelView.test.tsx 2>/dev/null || true
git mv src/components/inspector/adjustments/HslSingleBandView.test.tsx src/components/widget/hsl/HslSingleBandView.test.tsx 2>/dev/null || true
```

- [ ] **Step 4: Update imports**

Change `from '@/components/inspector/adjustments/HslPanelView'` → `from '@/components/widget/hsl/HslPanelView'` (and similarly for `HslSingleBandView`) in:
- `src/components/widget/HslWidgetBody.tsx`
- `src/components/inspector/adjustments/HslSectionBody.tsx`

Inside the moved files, also fix any cross-imports between them (HslSingleBandView imports HslPanelView per the grep).

- [ ] **Step 5: Resolve internal imports**

```bash
cd /Users/anton/Dev/Projects/editor && grep -n "from '@/components/inspector" src/components/widget/hsl/*.tsx
```

For each surviving inspector-side dependency, apply the same triage as Task 5 Step 4 (helper → `lib/`, type → `types/`, component → flag).

A known dependency to watch: `HslParamSlider` lives in `inspector/adjustments/`. If `HslPanelView` uses it, it'll re-introduce a breach. In that case, either move `HslParamSlider` to `widget/hsl/HslParamSlider.tsx` (it's HSL-specific) and add another commit, OR move it to `ui/` if you find it's used elsewhere. Decide based on `grep -rln HslParamSlider src/` results.

If a fresh primitive needs to move to make this slice clean, finish it in this commit and call it out in the commit message.

- [ ] **Step 6: Run check**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. All HSL tests still pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(widget): move HslPanelView + HslSingleBandView to widget/hsl/

HSL panel + band views are widget primitives (widget body composes
them); inspector section body now imports from widget/, the allowed
direction.

Audit follow-up — H25 (slice 6/6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all six tasks, verify the rule holds:

- [ ] **Step 1: Confirm no widget → inspector imports remain**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "from '@/components/inspector" src/components/widget/ --include='*.tsx' --include='*.ts'
```

Expected output: **nothing**. If any file lists, that import wasn't anticipated in this plan — flag it and address in a follow-up commit on this branch.

- [ ] **Step 2: Confirm ui/ doesn't import from widget/ or inspector/**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "from '@/components/widget\|from '@/components/inspector" src/components/ui/ --include='*.tsx' --include='*.ts'
```

Expected: nothing. `ui/` is the leaf; everything depends on it, it depends on no other topic folder.

- [ ] **Step 3: Run full check one more time**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. ≥773 tests pass.

---

## Out of scope

- The separate `registry-controls/CurveEditor.tsx` — different component, not in this plan.
- The pre-existing `registry-controls/` folder boundaries — they're already a separate layer; touching them is its own plan.
- Renaming any of the moved primitives — keep filenames + symbol names exact.
- Visual / styling changes — pure reorg.

## Done when

- 6 commits land on the branch, each isolating one primitive's move (Tasks 1–6).
- Final-verification greps return empty.
- `npm run check` is green.
