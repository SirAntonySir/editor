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

**UI:** A new icon button in `WidgetShellHeader.tsx`, placed between the dirty dot and the scope chip:

- icon: `Eye` (visible) / `EyeOff` (hidden) from `lucide-react`, size 11
- `aria-label`: `"Hide widget"` / `"Show widget"`
- `onClick` calls `e.stopPropagation()` so the header's expand toggle doesn't fire
- styled to match the existing footer button affordance (text-secondary → text-primary on hover, no background pill)

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

**UI:** A new icon button in the top-right corner of `ImageNode`, stacked to the left of the existing Split button:

- icon: `Eye` from `lucide-react`, size 10
- positioning: `absolute -top-2 -right-[26px]` (or similar), `chromeScale`-aware via the same `cornerBtnScale` transform pattern Split already uses
- `aria-label`: `"Show original (hold)"`
- visible only when `selected` (same gate as Split)
- handlers:
  - `onPointerDown` → `e.preventDefault()`, `setCompareHeld(true)`
  - `onPointerUp` / `onPointerLeave` / `onPointerCancel` → `setCompareHeld(false)`
  - `preventDefault` stops React Flow from interpreting the gesture as a node drag

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
| `src/components/widget/WidgetShellHeader.tsx` | Eye icon button + handler |
| `src/components/widget/WidgetShellHeader.test.tsx` | Eye click does not propagate; aria-label flips |
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
2. **`WidgetShellHeader.test.tsx`** — eye button renders; clicking it does not fire the header's onToggle (assert via spy); aria-label flips between "Hide widget" and "Show widget" based on `hidden` prop.
3. **`WidgetShell.test.tsx`** — when `hiddenWidgetIds` contains the widget id, the root has `opacity-60`.
4. **`image-node-renderer.test.ts`**
   - Given a widget node n in `hiddenNodeIds`, n's adjustment is not in the `Adjustment[]` passed to `PipelineManager`.
   - With `bypassAdjustments: true` and a layer that has adjustment nodes, `PipelineManager.renderSync` is not called; the layer's source is drawn to the composite canvas at the layer's opacity and blend mode.
5. **`ImageNode.test.tsx`** — pointerDown on the compare button sets the body's `bypassAdjustments` prop to `true`; pointerUp / pointerLeave clears it. (Assert via the prop contract on `ImageNodeBody`, not via canvas pixels.)

---

## Risks / open questions

- **None blocking.** The renderer additions are purely subtractive (skip a node, skip a pass) and don't introduce new pipelines.
- If users find the compare button position cramped next to Split, the corner row can become a flex container of icon-buttons in a follow-up. Not done now to keep the diff focused.
