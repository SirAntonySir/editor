# Widget visibility toggle + ImageNode before/after compare

**Date:** 2026-06-02
**Branch:** `feat/canvas-workspace`
**Scope:** Two small UI affordances on the canvas: an eye icon on each widget shell that hides its render effect, and a press-and-hold compare button on each ImageNode that temporarily shows the un-adjusted composite.

---

## Motivation

Users currently have no way to (a) preview the image without a specific widget's contribution short of resetting all bindings, or (b) A/B the edited result against the original. Both are table-stakes affordances in any non-destructive editor. Both can be added without backend changes by exploiting existing state (op-graph nodes per widget, source bitmaps in `CanvasRegistry`).

## Non-goals

- Persisting hide state across reload, in `.edp`, or in backend export.
- A keyboard shortcut (Lightroom-style `Y`).
- A "hide all widgets" affordance.
- A latched / split-view compare mode.

---

## Design

### 1. Widget visibility (eye icon on WidgetShellHeader)

**State (frontend-only, mirrors `layer.visible`):**

Extend `src/store/tool-slice.ts`:

```ts
hiddenWidgetIds: Set<string>;
toggleWidgetHidden(id: string): void;
```

`toggleWidgetHidden` adds/removes the id idempotently. Initial state: empty set.

**UI:** A new icon button in `WidgetShellHeader.tsx`, placed at the right end of the header just before the expand chevron (i.e. after the scope chip, before `⌄` / `›`):

- icon: `Eye` (visible) / `EyeOff` (hidden) from `lucide-react`, size 11
- `aria-label`: `"Hide widget"` / `"Show widget"`
- `onClick` calls `e.stopPropagation()` so the header's expand toggle doesn't fire
- styled to match the existing footer button affordance (text-secondary → text-primary on hover, no background pill)

**Drop the dirty dot.** As part of this change, remove the existing "bindings edited" indicator from `WidgetShellHeader` (the blue 5×5 dot rendered when `dirty === true`). The `dirty` computation in `WidgetShell` stays — keep it as the prop interface in case future affordances want it — but the header no longer renders it. Rationale: the slider provenance colour already shows edited-state per binding when the shell is expanded; collapsed shells don't need a separate signal once the eye becomes the action right of the scope chip.

**Hidden-state styling:** `WidgetShell` receives a derived `hidden` boolean and adds `opacity-60` to its root when hidden. Sliders inside stay interactive — hide affects render only, not editing.

**Renderer integration:** Extend `renderImageNodeComposite` (`src/lib/image-node-renderer.ts`) with an extra arg:

```ts
hiddenNodeIds: Set<string>;
```

Both filter passes skip nodes whose id is in the set:

```ts
const layerNodes = nodes.filter(
  (n) => n.layer_id === layerId && !hiddenNodeIds.has(n.id)
);
// …
const nodeScopeNodes = nodes.filter(
  (n) => !hiddenNodeIds.has(n.id) && /* existing layer-set check */
);
```

`useImageNodeRender` builds the set from `hiddenWidgetIds` + `snapshot.widgets`: for each widget whose id is in `hiddenWidgetIds`, union all `widget.nodes[].id`. It subscribes to `hiddenWidgetIds` (via `useEditorStore`) so renders re-fire on toggle.

**Trade-off:** Hidden state does not persist across reload and is not visible to backend export. Accepted, matches the `layer.visible` precedent.

### 2. Before/after compare (press-and-hold on ImageNode)

**State (transient, local to `ImageNode`):** `const [compareHeld, setCompareHeld] = useState(false)`. No store changes — only the one node that owns the button needs to know.

**UI:** A new icon button placed inline in the existing top header strip of `ImageNode` (the same strip that renders the `Image` icon, the title, and the `N LAYERS` badge), positioned between the title and the badge:

- icon: `Eye` from `lucide-react`, size 11
- styling: matches the layer-strip badge surface — small 16×16 inline button, transparent background, `text-text-secondary → text-text-primary` on hover, 3px radius
- `aria-label`: `"Show original (hold)"`
- visible whenever the ImageNode is rendered (no `selected` gate — the header strip is always on)
- because the parent header strip carries `workspace-drag-handle` (React Flow's drag region), the button must:
  - `onPointerDown` → `e.stopPropagation()` and `e.preventDefault()`, `setCompareHeld(true)`
  - `onPointerUp` / `onPointerLeave` / `onPointerCancel` → `setCompareHeld(false)` (also `stopPropagation` on the down event is what prevents React Flow from starting a drag on this pointer)

**Wiring:** `compareHeld` flows `ImageNode` → `ImageNodeBody` → `useImageNodeRender` → `renderImageNodeComposite` as a new `bypassAdjustments: boolean` argument.

**Renderer behavior when `bypassAdjustments === true`:**

- per-layer pass: skip the `PipelineManager.renderSync(adjustments)` call; set `rendered = source` directly, then composite with the layer's blend mode and opacity as today
- composite-then-apply (node-scope) pass: skipped entirely
- overlay pass: unchanged (selection chrome, mask outlines stay visible)

"Before" therefore means: every visible layer's source bitmap, composited with blend modes/opacities, no shader passes.

---

## Files touched

| File | Change |
|---|---|
| `src/store/tool-slice.ts` | Add `hiddenWidgetIds`, `toggleWidgetHidden` |
| `src/store/tool-slice.test.ts` | Toggle behavior tests |
| `src/components/widget/WidgetShellHeader.tsx` | Eye icon button + handler (placed right of scope chip, before chevron); remove dirty-dot render |
| `src/components/widget/WidgetShellHeader.test.tsx` | Eye click does not propagate; aria-label flips; dirty-dot is never rendered |
| `src/components/widget/WidgetShell.tsx` | Derive `hidden`, apply `opacity-60` |
| `src/components/widget/WidgetShell.test.tsx` | Hidden class assertion |
| `src/hooks/useImageNodeRender.ts` | Subscribe to `hiddenWidgetIds`; build `hiddenNodeIds`; thread `bypassAdjustments` |
| `src/lib/image-node-renderer.ts` | New args `hiddenNodeIds`, `bypassAdjustments`; filter passes; short-circuit shader path |
| `src/lib/image-node-renderer.test.ts` | Hidden-node filter; bypass skips `PipelineManager` |
| `src/components/workspace/ImageNode.tsx` | Compare button + pointer handlers; pass through to body |
| `src/components/workspace/ImageNodeBody.tsx` | Accept `bypassAdjustments` prop, forward to hook |
| `src/components/workspace/ImageNode.test.tsx` | Pointer events flip the prop |

No backend changes. No new files.

---

## Testing strategy (TDD)

1. **`tool-slice.test.ts`** — `toggleWidgetHidden` adds an id then removes it; second toggle on a new id leaves the first present.
2. **`WidgetShellHeader.test.tsx`** — eye button renders to the right of the scope chip and before the chevron; clicking it does not fire the header's onToggle (assert via spy); aria-label flips between "Hide widget" and "Show widget" based on `hidden` prop; the previous dirty-dot element is no longer in the DOM regardless of `dirty` prop value.
3. **`WidgetShell.test.tsx`** — when `hiddenWidgetIds` contains the widget id, the root has `opacity-60`.
4. **`image-node-renderer.test.ts`**
   - Given a widget node n in `hiddenNodeIds`, n's adjustment is not in the `Adjustment[]` passed to `PipelineManager`.
   - With `bypassAdjustments: true` and a layer that has adjustment nodes, `PipelineManager.renderSync` is not called; the layer's source is drawn to the composite canvas at the layer's opacity and blend mode.
5. **`ImageNode.test.tsx`** — pointerDown on the compare button sets the body's `bypassAdjustments` prop to `true`; pointerUp / pointerLeave clears it. (Assert via the prop contract on `ImageNodeBody`, not via canvas pixels.)

---

## Risks / open questions

- **None blocking.** The renderer additions are purely subtractive (skip a node, skip a pass) and don't introduce new pipelines.
- The ImageNode top header strip carries React Flow's `workspace-drag-handle` class. The compare button must `stopPropagation` on `pointerdown` so the press doesn't simultaneously initiate a node drag. The existing `ImageNodeSelectionPopover` wrapping the strip listens for clicks too — verify in the test that the popover does not open when the compare button is pressed.
