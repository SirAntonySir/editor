# Zoom-Aware Scaling — Drop the Counter-Scale (Figma Model)

**Status:** Draft
**Date:** 2026-06-09
**Author:** Anton (with Claude)
**Branch:** to be created off `feat/circular-compound-dial` (or `main` post-merge)

---

## 1. Problem

Today, `useChromeScale = 1/zoom` counter-scales every workspace element except the image bitmap. Widgets, image chrome (border, file label, drag handles), and tether edges all stay at fixed screen size while the image scales. Result: the UI "floats" — disconnected from the image it's editing.

Anton: *"the rules we have for sizes on the screen are really bad. The zoom-aware scaling needs to be only for the fonts not for the widgets itself maybe. How does Figma do this?"*

The user-visible pain:
- At low zoom (overview), widgets dwarf the image they're attached to. The wheel becomes bigger than the canvas it controls.
- At high zoom (detail editing), widgets feel detached — they don't grow with the work surface.
- Tether edges have constant screen thickness — at high zoom they look stringy, at low zoom they look bold.
- Conceptually: the editor lies about what's "content" and what's "chrome". Image is content (scales); everything else is chrome (counter-scales). But widgets ARE the user's working surface, not chrome.

Figma resolves this differently: frames, text, shapes are canvas-space objects that scale with zoom. Only handles, selection indicators, and panel labels (real chrome) stay screen-fixed. We want the same model.

## 2. Goals

1. **Widgets live in canvas space.** They scale with zoom like image bitmaps do.
2. **Image chrome lives in canvas space.** Border, file label, handles all scale with zoom.
3. **Tether edges live in canvas space.** Stroke-width is in canvas pixels.
4. **LOD hide at extreme zoom-out.** Below `CHROME_VISIBLE_FLOOR`, widget body collapses to a small colored `MarkerDot`. Reduces clutter and skips expensive render passes.
5. **No readability floor.** At low zoom, widgets are small (then collapse to dots). At high zoom, they're big. Same as Figma.
6. **Real UI chrome stays unaffected.** Inspector panel, toolbars, top bar — all outside React Flow — continue to render at fixed screen size.

## 3. Non-goals

- Configurable per-widget scale mode (e.g. lock-screen-size toggle) — YAGNI.
- Configurable readability floor — picked "no floor" per Q3; if usage shows we need it, add later.
- Touch-friendly minimum tap targets — orthogonal to scaling.
- Inspector / panel zoom — unrelated to canvas zoom.
- Replacing `useChromeVisible`'s LOD threshold logic with anything fancier (LOD remains a single zoom threshold).

## 4. Architecture

The change is small, focused, and four orthogonal commits:

```
src/hooks/useChromeScale.ts                STUB to return 1, then delete in commit 4
src/hooks/useChromeVisible.ts              UNCHANGED — already implements LOD-hide
src/components/workspace/WidgetNode.tsx    Remove transform-scale wrapper; add MarkerDot fallback
src/components/workspace/ImageNode.tsx     Remove chrome-layer transform
src/components/workspace/TetherEdge.tsx    Remove scale * stroke-width math
src/components/workspace/MarkerDot.tsx     NEW — 16x16 colored circle for LOD-hidden widgets
```

Nothing else changes. The image bitmap was never counter-scaled. React Flow's zoom transform already scales everything in canvas space natively.

## 5. Component changes

### 5.1 `useChromeScale.ts` — stub then delete

Step 1 (commit 1): replace the function body with a stub:

```typescript
/** Deprecated. Widgets, image chrome, and tether edges now live in canvas
 *  space (Figma model). Counter-scaling is removed. This stub returns 1
 *  for any remaining callers; delete once no consumers reference it. */
export function useChromeScale(): number {
  return 1;
}
```

Step 4 (commit 4): grep for `useChromeScale` and delete the file once no consumers remain.

### 5.2 `useChromeVisible.ts` — unchanged

Already returns `false` at low zoom. The threshold (likely ~0.2 in `src/hooks/useChromeVisible.ts`) stays. If smoke testing shows the threshold feels wrong, tune the constant — no architectural change.

### 5.3 `WidgetNode.tsx` — remove transform, add MarkerDot

Before:

```tsx
const scale = useChromeScale();
const chromeVisible = useChromeVisible();
return (
  <>
    {/* handle positions use scaledW = naturalSize.w * scale */}
    <Handle ... style={{ left: `${scaledW}px`, top: headerY }} />
    {chromeVisible && (
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <WidgetShell widget={data.widget} selected={selected} />
      </div>
    )}
  </>
);
```

After:

```tsx
const chromeVisible = useChromeVisible();
return (
  <>
    {/* handles positioned at natural box corners — no scale math */}
    <Handle ... style={{ left: `${naturalW}px`, top: headerY }} />
    {chromeVisible ? (
      <WidgetShell widget={data.widget} selected={selected} />
    ) : (
      <MarkerDot widget={data.widget} />
    )}
  </>
);
```

The `useChromeScale` import is removed. Handle positions go to the natural box (not scaled). `useUpdateNodeInternals` continues to trigger when `naturalSize` changes — React Flow recomputes connection geometry without extra work.

### 5.4 `ImageNode.tsx` — remove chrome-layer transform

Before:

```tsx
const chromeScale = useChromeScale();
...
<div className="image-chrome" style={{ transform: `scale(${chromeScale})`, transformOrigin: 'top left' }}>
  <div className="border" />
  <span className="file-label">{name}</span>
  {/* drag handles */}
</div>
```

After:

```tsx
<div className="image-chrome">
  <div className="border" />
  <span className="file-label">{name}</span>
  {/* drag handles */}
</div>
```

The image bitmap layer (which was never counter-scaled) is unaffected. Border, file label, and handles now scale natively with React Flow's transform.

### 5.5 `TetherEdge.tsx` — drop the scale multiplier

Before:

```tsx
const scale = useChromeScale();
const strokeWidth = BASE_STROKE * scale;
return <path d={path} strokeWidth={strokeWidth} ... />;
```

After:

```tsx
const strokeWidth = BASE_STROKE;   // canvas-space pixels
return <path d={path} strokeWidth={strokeWidth} ... />;
```

`BASE_STROKE` becomes a canvas-space constant (likely 2). At zoom=1 the edge is 2px on screen; at zoom=2 it's 4px; at zoom=0.5 it's 1px. Same as Figma frame connectors.

### 5.6 `MarkerDot.tsx` — new

```tsx
import type { Widget } from '@/types/widget';

interface Props {
  widget: Widget;
}

const CATEGORY_COLORS: Record<string, string> = {
  tone:    '#3b82f6',
  color:   '#a855f7',
  detail:  '#22c55e',
  texture: '#eab308',
  effect:  '#ec4899',
  mood:    '#6d5cff',
};

export function MarkerDot({ widget }: Props) {
  const color = CATEGORY_COLORS[widget.category ?? ''] ?? '#6d5cff';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16"
         style={{ pointerEvents: 'none' }}>
      <circle cx="8" cy="8" r="6" fill={color} opacity="0.85" />
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
```

The dot is 16×16 in canvas units — so it'll be small at any zoom but visible enough to indicate "a widget exists here". Colored by category so the user can scan multiple widgets at a glance.

## 6. Data flow

Nothing changes in data flow. Same widget creation, same backend, same SSE. The only difference is render-time:

```
React Flow canvas transform: scale(zoom)
  → applies to all nodes
    → WidgetNode renders WidgetShell (no counter-scale)  ← widget grows/shrinks with zoom
    → ImageNode renders chrome (no counter-scale)        ← border, label grow/shrink with zoom
    → TetherEdge renders path (canvas-space stroke)      ← stroke thickness scales with zoom
```

At zoom < `CHROME_VISIBLE_FLOOR`:

```
React Flow canvas transform: scale(low_zoom)
  → WidgetNode renders MarkerDot                          ← tiny colored dot
    (skipping WidgetShell render entirely — performance win)
```

## 7. Failure handling

| Failure | Behavior |
|---|---|
| Widget at zoom 0.01 — too small to read | `chromeVisible` is false → `MarkerDot` renders. No legibility crisis. |
| Widget at zoom 8 — dominates screen | Intentional. User chose to zoom in for detail; widget is part of that detail. |
| Tether edge becomes hairline at low zoom | Same as Figma frame arrows. If too invisible in smoke test, bump `BASE_STROKE` (tuning, not architecture). |
| `useChromeScale` callers we missed | Stub returns 1 → calls behave correctly. Grep + delete in commit 4. |
| ImageNode resize handles miss-positioned | They were computing position using `chromeScale`. After removal, they use the natural box — should be cleaner. Verify in smoke test. |
| User reports widgets too small at typical zoom | Suggest zooming in. If multiple users feedback this way, revisit "configurable scale floor" as a follow-up spec. |
| `MarkerDot` invisible at extreme zoom (e.g. 0.001) | Floor enforced by `chromeVisible` threshold. Below floor, dot still renders but is a few screen pixels — visible enough for spatial context. |

## 8. Migration

Four commits, each independently revertable:

1. **Stub `useChromeScale`** — replace function body with `return 1`. All callers immediately get the new behavior; no other edits. Visible commit: widgets, image chrome, tether edges scale with zoom for the first time.
2. **Clean up `WidgetNode`** — remove transform wrapper, simplify handle math, add `MarkerDot` fallback.
3. **Clean up `ImageNode`** — remove chrome-layer transform.
4. **Clean up `TetherEdge`** + **delete `useChromeScale.ts`** — drop the scale multiplier and the stub file.

Each commit is verifiable in dev server:
- After 1: widgets scale with zoom (test by dragging zoom in/out).
- After 2: code clean; `MarkerDot` appears at extreme zoom-out.
- After 3: image border + label scale with image.
- After 4: tether strokes scale.

## 9. Testing

| Tier | What | Where |
|---|---|---|
| Unit | `useChromeScale()` returns 1 regardless of canvas zoom | `useChromeScale.test.ts` (extend) |
| Unit | `useChromeVisible()` returns false below threshold, true above | `useChromeVisible.test.ts` (verify or add) |
| Component | `WidgetNode` renders `<WidgetShell>` when chromeVisible is true | `WidgetNode.test.tsx` (extend) |
| Component | `WidgetNode` renders `<MarkerDot>` when chromeVisible is false | same |
| Component | `WidgetNode` no longer applies transform-scale style to the wrapper | same |
| Component | `MarkerDot` renders a 16×16 circle colored by widget category | new `MarkerDot.test.tsx` |
| Integration | Tether edge stroke width is constant in canvas space (not scaled by zoom) | `TetherEdge.test.tsx` (extend) |
| Visual smoke | Manual: zoom 0.1 → MarkerDots; zoom 1 → natural widgets; zoom 4 → big widgets attached to big image | not automated |

## 10. Definition of done

After commit 4:

- Widgets scale with canvas zoom (same as the image bitmap).
- Image chrome (border, file name label, drag handles) scales with zoom.
- Tether edges scale with zoom (stroke-width in canvas units).
- Below `CHROME_VISIBLE_FLOOR` zoom, widgets collapse to `MarkerDot` colored by category.
- `useChromeScale` is deleted.
- At all common zooms (0.5 – 2.0), widgets feel anchored to the image they're tethered to.
- No counter-scaling math remains in `WidgetNode`, `ImageNode`, or `TetherEdge`.
- All existing tests pass (with `useChromeScale` mocks updated where present).
- New `MarkerDot` test passes.
- `npx tsc --noEmit` clean.

## 11. Open questions deferred

1. **Tether edge stroke tuning.** `BASE_STROKE = 2` might feel too thin at low zoom or too thick at high zoom. Iterate during smoke test; if 2 is wrong, find the right number empirically.
2. **MarkerDot icon.** Today it's just a colored circle. A small icon (op category icon — e.g. sun for tone, droplet for color) inside the dot would convey more at a glance. Defer to a "MarkerDot polish" follow-up.
3. **Configurable readability floor.** If "no floor" feels rough in practice, expose a `WIDGET_SCALE_MODE` setting (`"natural"` vs `"floored"`). Don't preempt user feedback.
4. **Performance.** At low zoom, multiple `MarkerDot` SVGs may render. Each is trivial, but if a future workflow spawns 100+ widgets, consider canvas-rendered dots instead. Defer.
5. **Touch / mobile.** Min tap targets become an issue at lower zooms. Touch story is a separate spec.

## 12. Why these choices

**Why no readability floor (Q3 = "no floor")?**
A floor adds branch logic and complicates the mental model. With Figma's model — pure scaling — the LOD-hide threshold (Q4) handles the unreadable-zoom case directly. No widget body renders below floor; a `MarkerDot` indicates the location. Simpler, fewer constants, mirrors Figma exactly.

**Why a colored MarkerDot rather than complete hide?**
Spatial reference. At 5% zoom the user is doing overview navigation; seeing "5 widgets clustered around the image's bottom-left" is useful information even without seeing their controls. Total hide would lose that. Figma's "text → placeholder line" is the same idea: keep the shape, drop the content.

**Why scale image chrome too?**
Consistency. If the image border scales but the widget doesn't, the inconsistency is the new bug. Once we accept "canvas space wins," everything in canvas space — chrome around image, edges between things, widget bodies — should follow.

**Why drop `useChromeScale` instead of repurposing?**
The hook's job was counter-scaling. With no counter-scale, the hook has no job. A stub for one commit, then delete. Keeping it as a "scale = 1" function would invite future misuse.

**Why not preserve the linear PerceptualDialBody slider's screen-fixed feel?**
The slider currently uses CSS for its width, which scales naturally with zoom anyway (browser scales `<input type="range">` like any other element). After this change, the slider follows the same rule as the wheel — it scales with the widget body. Same model everywhere.
