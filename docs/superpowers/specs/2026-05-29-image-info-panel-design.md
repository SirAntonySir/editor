# Image Info Panel — Design

**Date:** 2026-05-29
**Status:** Approved (design phase)
**Branch context:** `feat/canvas-centric-ui`

## Problem

The backend computes a rich `EnrichedImageContext` (semantic AI labels + histograms + clipping percentages + palette + cast vector + per-region stats + detected problems), but the frontend currently consumes only a slice of it (skeleton-region filtering during `mask_precompute`). The rest is invisible to the user even though it's the same data the LLM is reasoning over and the same data that would help the user judge their edits.

Surface that data in a new "Info" tab inside the Inspector.

## Goal

A read-only, always-up-to-date Info surface inside the Inspector that exposes the four most useful slices of `image_context`:

- **Semantic** — what's in the picture (subjects, mood, lighting, dominant tones, grade character)
- **Histograms** — luma + per-channel RGB histograms, clipping percentages, median luma, contrast
- **Color** — palette swatches, estimated white point, color-cast strength + direction
- **Regions & problems** — candidate regions list, detected problems list

## Non-goals

- Region interactivity (hover-highlight on canvas, click-to-scope).
- Problem-to-tool launch (clicking a problem proposes a widget).
- Histogram tooltips, zoom, or numeric pixel-count callouts.
- Persisting tab selection across reloads.
- Region thumbnails larger than 32 px square.
- Server-side endpoint changes.
- A separate floating Info panel — the tab lives inside the existing Inspector.

## Approach

Add a 2-state tab switcher at the top of `InspectorPanel`. State is local React state — UI-only, not persisted, not part of any Zustand slice. The default tab is `"adjustments"` which renders today's stack unchanged. The new `"info"` tab renders `<InfoTab />`.

`InfoTab` reads the backend snapshot's `image_context` via a new selector hook `useImageContextFull()`, narrows the `unknown` payload to a frontend-typed `EnrichedImageContext`, and renders four section components in fixed order.

Three new presentational primitives in `src/components/ui/` cover all the visualisation needs: `Histogram` (inline SVG), `Swatch` (single color div), `PercentBar` (filled horizontal bar). No charting library.

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `src/components/inspector/InspectorPanel.tsx` | Modify | Add `tab` local state + `<Tabs />` switcher. Default `"adjustments"`. |
| `src/components/inspector/info/InfoTab.tsx` | Create | Top-level content for the Info tab. Reads `useImageContextFull`. Renders 4 sections or an empty state. |
| `src/components/inspector/info/SemanticSection.tsx` | Create | Chips for `subjects` + `dominantTones`. Key/value rows for `lighting`, `mood`, `grade_character`. |
| `src/components/inspector/info/HistogramsSection.tsx` | Create | Stacked `Histogram` primitives (luma white, R/G/B tinted). Two `PercentBar`s for clipping. Two number rows for `median_luma` + `contrast_p10_p90`. |
| `src/components/inspector/info/ColorSection.tsx` | Create | Palette swatches (width weighted by `weight`), white-point RGB triplet, cast a*/b* dot. |
| `src/components/inspector/info/RegionsSection.tsx` | Create | List of `candidateRegions` (label + description + 32 px mask thumbnail from `maskPngBase64`). Separate list of `problems` (kind badge + severity bar + region label). |
| `src/components/ui/Histogram.tsx` | Create | SVG path histogram. Props: `bins: number[]`, `color: string`, `height = 40`, `width = 120`. |
| `src/components/ui/Swatch.tsx` | Create | One color square. Props: `rgb: [number, number, number]`, `size = 16`. Hover title shows hex. |
| `src/components/ui/PercentBar.tsx` | Create | 2 px-tall track + filled width. Props: `pct: number` (0–100), `color: string`, `label?: string`. |
| `src/hooks/useImageContextFull.ts` | Create | Selector hook: returns typed `EnrichedImageContext \| null`. |
| `src/types/enriched-context.ts` | Create | Frontend mirror of `EnrichedImageContext` fields. Extends `ImageContext`. |

## Components

### `InspectorPanel.tsx` — tab switch

Use the same Radix `ToggleGroup.Root` pattern as the toolbar (consistent design idiom). Tab values: `'adjustments' | 'info'`. State held with `useState`. Style: two text buttons side by side at the top of the panel with the active one accent-colored. Below the switcher, render either the existing 3-section stack (Suggestions, Active, Layers) or `<InfoTab />`.

### `InfoTab.tsx`

```tsx
const ctx = useImageContextFull();
if (!ctx) return <Empty label="No image loaded." />;
return (
  <div className="flex flex-col gap-3 p-3">
    <SemanticSection ctx={ctx} />
    <HistogramsSection ctx={ctx} />
    <ColorSection ctx={ctx} />
    <RegionsSection ctx={ctx} />
  </div>
);
```

Each section component receives the whole `EnrichedImageContext` and reads what it needs. Sections are wrapped in `GlassPanel` for visual consistency with the rest of the inspector.

### Section behaviours

**SemanticSection** — `subjects` and `dominantTones` render as chip rows (single-line, wrap on overflow). `lighting`, `mood`, `grade_character` render as `<dt>label</dt><dd>value</dd>` pairs.

**HistogramsSection** — Three histograms stacked vertically with 4 px gap. Luma uses `var(--color-text-secondary)`; R/G/B use Tailwind `red-500`/`green-500`/`blue-500` at 70 % opacity. Below the histograms: two `PercentBar`s ("Clipped shadows", "Clipped highlights"). Below those: two compact "Median luma: 0.42" / "Contrast (p10–p90): 0.31" rows.

**ColorSection** — `color_palette` swatches in a single flex row; each swatch is `flex-grow: weight` capped at 1, min 8 px. Below: estimated white point as "rgb(248, 244, 240)" text. Below that: a 60 × 60 px square with axes labelled `a*` / `b*`, a single dot positioned by mapping each component of `cast_direction` from the assumed Lab a*/b* range of `±50` (clamp out-of-range) onto `[0, 60]` px. Dot opacity = `cast_strength`. Skip the cast box if `cast_strength === 0`.

**RegionsSection** — Each candidate region is a row: 32 × 32 px `<img>` from `data:image/png;base64,${maskPngBase64}` (or a placeholder block if absent), the label, and the description on a second line. Below the regions list, a separator and a list of problems: kind badge (small uppercase), severity as a `PercentBar` from 0–100, region label if present, suggested fused-tool names as text. If `problems` is empty (Claude pass not done), the problems sublist isn't rendered at all.

### Primitives

**`Histogram`** — Build `path d="M0,${h} L0,${h-b0*h/max} L1,${h-b1*h/max} ... L${w},${h} Z"` from normalised bins; fill with `color`; `viewBox` = `"0 0 width height"`; aria-hidden.

**`Swatch`** — `<div style={{ width: size, height: size, backgroundColor: \`rgb(${r}, ${g}, ${b})\` }} title="#rrggbb" />`.

**`PercentBar`** — outer `<div>` with track background (token), inner `<div>` with `width: ${pct}%`. Optional label and `{pct.toFixed(1)}%` numeric on right.

## Data flow

```
backend snapshot
  → useBackendState.snapshot.image_context     // typed `unknown` today
    → useImageContextFull()                    // narrow + return null on missing
      → InfoTab → 4 sections → primitives
```

`useImageContextFull` is just:

```ts
export function useImageContextFull(): EnrichedImageContext | null {
  return useBackendState((s) => s.snapshot?.image_context as EnrichedImageContext | null ?? null);
}
```

No new SSE plumbing — `context.updated` events already mutate `snapshot.image_context` in `backend-state-slice.applyEvent`.

## Loading and partial states

The Info tab is always interactive once a session exists. Partial data is the norm during phase progression:
- `mechanical` phase complete → histograms, clipping, palette populated.
- `ai_context` phase complete → semantic fields populated.
- `mask_precompute` complete → region thumbnails available.
- Final Claude pass complete → `problems`, `grade_character`, `wb_neutral_confidence`.

No skeletons. Each section renders whatever it has; empty subsections collapse. The cast dot omits when `cast_strength === 0`. Problems list omits when empty.

## Error handling

`image_context` is `unknown` until typed. The narrowing cast in `useImageContextFull` is intentionally trusting — the contract with the backend is owned by `EnrichedImageContext` and there's no defensive runtime validation. If the shape drifts, components render best-effort (TypeScript catches the obvious cases).

`maskPngBase64` may be missing on legacy contexts; the region row uses a transparent placeholder block of the same size. No fallback rasterisation from `paths` — too expensive for an info display.

## Testing

### Unit — primitives

- `src/components/ui/Histogram.test.tsx` — given `[1, 2, 0, 0, 4]`, asserts the rendered SVG path string has 5 line segments scaled correctly. Asserts `aria-hidden`.
- `src/components/ui/Swatch.test.tsx` — given `[255, 0, 128]`, asserts inline style background and title `#ff0080`.
- `src/components/ui/PercentBar.test.tsx` — given `pct=42`, asserts inner div has `width: 42%` and label text `"42.0%"` renders when supplied.

### Unit — sections

- `src/components/inspector/info/InfoTab.test.tsx`:
  - Renders `"No image loaded."` when `useImageContextFull()` returns null (i.e. `snapshot` or `snapshot.image_context` is null).
  - Renders all four sections when given a complete fixture context.
  - Renders without crashing when given a partial fixture (no `problems`, default `grade_character`).

- One small fixture file `src/components/inspector/info/__fixtures__/enriched-context.ts` that exports a `makeFullContext()` and `makePartialContext()` factory pair, used by the test above.

### Integration

- `src/components/inspector/InspectorPanel.test.tsx` — extend the existing test (or add a sibling one) to assert: default tab is "Adjustments" (existing sections visible); clicking "Info" hides them and renders `<InfoTab />`.

## Out-of-scope follow-ups (do NOT bundle into this work)

- Hovering a region in the list highlights its mask overlay on the canvas.
- Clicking a region activates it as the scope for the next widget spawn.
- Clicking a problem opens its `suggested_fused_tools` as a propose-widget call.
- Histogram tooltips showing bin count at the cursor.
- Persisting selected tab across sessions.
- Surfacing per-region `region_stats` (sub-histograms etc.) — wait for user demand.
