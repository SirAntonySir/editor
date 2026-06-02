# Image-Node Styling Parity + Zoom-Invariant Chrome

**Date:** 2026-06-02
**Branch context:** `feat/canvas-workspace`

## Problem

Two related visual issues with workspace nodes:

1. **Styling mismatch.** `ImageNode` and `WidgetShell` both use the `.overlay` class, so their base treatment is identical. But selected `ImageNode` shows a harsh 2px accent outline (`outline-2 outline outline-accent -outline-offset-1`), while widgets only change border color on hover. AI widgets get a violet bloom (`widget-shell-ai`); image nodes have no equivalent "active" glow. The result reads as two different visual languages on the same canvas.
2. **Zoom shrinks the frame.** React Flow zoom is CSS-transform-based, so the entire DOM scales with the viewport. `useChromeScale` already counter-scales the header/footer strips and the corner button, but the `.overlay` container's 1px border, 8px radius, and box-shadow all shrink with zoom. Tether edges already solve this by multiplying their geometry by `useChromeScale`; nothing else does.

## Decisions (from brainstorm)

- **Full-frame zoom invariance.** The outer container's border thickness, corner radius, and shadow geometry must also counter-scale. Only the bitmap inside scales. Apply to both `ImageNode` *and* `WidgetShell` (they share `.overlay`, so they stay in lockstep).
- **One color rule for the whole canvas:**
  - **Violet (`--color-ai`) is reserved for AI identity.** Only AI-composed widgets (`widget-shell-ai`) ever use violet.
  - **Accent (`--color-accent`) carries selection state for everything else.** Image node and tool-invoked widgets gain the same accent glow on selection. AI widgets stay violet — selection does not layer accent on top.
- **Selection glow shape.** Replace the image node's 2px outline with the same layered-shadow technique as `widget-shell-ai` (1px ring + soft bloom), in accent. Same rule applies to selected tool widgets.
- **Hover treatment unchanged** — `border-accent` only; keep hover lighter than selection.
- **Tethers enter from the nearest side.** Image-node connection handles exist on top, bottom, left, and right; `pickTetherHandles` picks the side closest to the widget so tethers never have to cross the image-node body to reach the widget.

## Architecture

### 1. Counter-scaled `.overlay` (CSS variables)

Currently `.overlay` is a static rule:

```css
.overlay {
  background: var(--color-surface);
  border: 1px solid var(--color-border-strong);
  box-shadow: var(--shadow-overlay);
  border-radius: var(--radius-panel);
}
```

We move the geometry values behind CSS custom properties so consumers can override them per-instance with `useChromeScale`:

```css
.overlay {
  background: var(--color-surface);
  border: var(--overlay-border-width, 1px) solid var(--color-border-strong);
  border-radius: var(--overlay-radius, var(--radius-panel));
  box-shadow: var(--overlay-shadow, var(--shadow-overlay));
}
```

Workspace nodes pass `style={{ '--chrome-scale': String(chromeScale), '--overlay-border-width': `${chromeScale}px`, '--overlay-radius': `${8 * chromeScale}px`, '--overlay-shadow': `0 ${4 * chromeScale}px ${14 * chromeScale}px rgba(0,0,0,0.10)` }}` on their root. `--chrome-scale` is also consumed by the selection-glow rule below.

Non-workspace `.overlay` consumers (menus, dropdowns, tooltips, dialogs) are unaffected — they fall through to the defaults.

### 2. Selection glow utility

Add a single utility class that workspace nodes opt into when selected:

```css
.workspace-node-selected {
  border-color: var(--color-accent);
  box-shadow:
    0 0 0 calc(var(--overlay-border-width, 1px)) color-mix(in srgb, var(--color-accent) 35%, transparent),
    0 0 calc(14px * var(--chrome-scale, 1)) calc(2px * var(--chrome-scale, 1)) color-mix(in srgb, var(--color-accent) 28%, transparent),
    var(--overlay-shadow, var(--shadow-overlay));
}
```

The class consumes `--chrome-scale` (a new var) so the bloom radius counter-scales too. Image node sets `--chrome-scale` on its root via inline style.

`widget-shell-ai` is left alone — it already wins specificity by setting its own `box-shadow` and we want violet to dominate selection on AI widgets.

### 3. Image node selection wiring

Replace the current outline classname in `ImageNode.tsx`:

```diff
- className={`overlay overflow-hidden ${selected ? 'outline-2 outline outline-accent -outline-offset-1' : ''}`}
+ className={`overlay overflow-hidden ${selected ? 'workspace-node-selected' : ''}`}
```

`selected` already comes from React Flow's node props.

### 4. Widget shell selection wiring

`WidgetShell` doesn't currently get a `selected` prop from React Flow — it's wrapped by `WidgetNode`. Pass `selected` down via the existing `hovered`/`focusedWidgetId` plumbing or directly from the React Flow node props.

Apply the same class:

```diff
- className={`overlay min-w-[226px] w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${hovered ? 'border-accent' : ''}`}
+ className={`overlay min-w-[226px] w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${selected && !showAiAffordances ? 'workspace-node-selected' : ''} ${hovered ? 'border-accent' : ''}`}
```

AI widgets (`showAiAffordances`) skip the accent glow — violet stays.

### 5. `useChromeScale` becomes a shared CSS variable

Workspace nodes already call `useChromeScale()`. They now also write it to `--chrome-scale` on their root style. That single var drives both `.overlay`'s geometry vars (above) and the selection glow's bloom.

The hook itself doesn't change.

### 6. Four-sided tether handles on the image node

Today `ImageNode` only mounts left/right target handles. When a widget spawns above or below the image, the tether path zig-zags around the node and frequently crosses the image body.

Change `ImageNode.tsx` to mount four target handles:

```tsx
<Handle type="target" position={Position.Top}    id="tether-in-top"    style={{ left: '50%', opacity: 0 }} />
<Handle type="target" position={Position.Bottom} id="tether-in-bottom" style={{ left: '50%', opacity: 0 }} />
<Handle type="target" position={Position.Left}   id="tether-in-left"   style={{ top:  `${10 * chromeScale}px`, opacity: 0 }} />
<Handle type="target" position={Position.Right}  id="tether-in-right"  style={{ top:  `${10 * chromeScale}px`, opacity: 0 }} />
```

Extend `WidgetNode` symmetrically with `tether-out-top` / `tether-out-bottom` source handles.

Update `pickTetherHandles` in `src/components/workspace/tether-handles.ts` from a two-way (left/right only) decision to a four-way one:

```ts
export function pickTetherHandles(
  widgetCenter: { x: number; y: number },
  imageBounds: { x0: number; y0: number; x1: number; y1: number },
): TetherHandlePick {
  // For each axis, compute distance from widget center to the nearer image edge.
  // Pick the axis that is closer; on that axis, pick the nearer side.
  // …
}
```

The picked side determines the matching widget exit handle (top widget exit pairs with bottom image entry, etc.).

`tether-handles.test.ts` is extended to cover all four quadrants, including widgets that overlap the image bounding box on one axis.

## Files Touched

- `src/index.css` — variable-driven `.overlay` rule + new `.workspace-node-selected` rule.
- `src/components/workspace/ImageNode.tsx` — set CSS vars on root, replace outline class, add top/bottom target handles.
- `src/components/widget/WidgetShell.tsx` — set CSS vars on root, accept `selected`, apply class.
- `src/components/workspace/WidgetNode.tsx` — forward React Flow `selected` to `WidgetShell`, add top/bottom source handles.
- `src/components/workspace/tether-handles.ts` — four-way handle picker.
- `src/components/workspace/tether-handles.test.ts` — coverage for all four quadrants.

No new files. No backend changes.

## Testing

- `ImageNode.test.tsx` — assert root inline style sets `--chrome-scale`, `--overlay-radius`, `--overlay-border-width`, `--overlay-shadow` from a stubbed `useChromeScale`; assert `workspace-node-selected` class appears when `selected` is true and the old `outline-2` class is gone.
- `WidgetShell.test.tsx` — assert AI widgets keep `widget-shell-ai` only when selected; non-AI widgets gain `workspace-node-selected`.
- Visual smoke test: open the workspace, zoom to 0.3 and 2.0; verify image node and widget frames look identical in on-screen border/radius/shadow at any zoom.

## Out of Scope

- No changes to tether edges (already counter-scaled).
- No changes to the `widget-shell-ai` rule itself.
- No changes to non-workspace consumers of `.overlay` (menus, dialogs).
- No changes to hover treatment.
