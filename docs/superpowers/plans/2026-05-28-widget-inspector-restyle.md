# Widget + Inspector + Toolbar Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the editor's UI: tools move to a 44px left vertical rail, the "Inspector" tab strip is removed, canvas widget cards become ultra-compact (header strip + tight bindings + Accept-flex + refine-icon), inspector becomes a dense 4-column grid with chevron-row inline expansion, and tool widgets match the compact form with a grey border.

**Architecture:** Pure restyle. No new components, no new state, no new types. Files touched: `Toolbar.tsx` (vertical), `App.tsx` (left rail slot), `RightSidebar.tsx` (drop TabStrip), `InspectorPanel.tsx` (rewrite), `InspectorWidgetRow.tsx` (rewrite as grid row + inline expand), `WidgetCard.tsx` (header-strip layout), `LifecycleActions.tsx` (compact two-variant), `ToolWidgetCard.tsx` (match compact), `CanvasWidgetLayer.tsx` (width tweak).

**Tech Stack:** React 19, TypeScript strict, Tailwind v4 with `@theme` tokens in `src/index.css`, Radix UI (ToggleGroup, Tooltip), Framer Motion for the toolbar active-button transitions, Zustand v5 + Immer for state.

**Spec reference:** [`docs/superpowers/specs/2026-05-28-widget-inspector-restyle-design.md`](../specs/2026-05-28-widget-inspector-restyle-design.md)

---

## Pre-flight

- [ ] **P0a:** Confirm `dev` branch + clean tree.

```bash
git branch --show-current && git status --short
```

Expected: `dev`, no uncommitted changes (the spec commit `f0d5a37` is the tip).

- [ ] **P0b:** Frontend baseline.

```bash
cd /Users/anton/Dev/Projects/editor
npx vitest run 2>&1 | tail -3
npx tsc -b 2>&1 | tail -3
npx eslint src/ 2>&1 | grep -E '✖' | tail -3
```

Expected: `Tests 123 passed`; tsc clean; eslint `0 errors`.

- [ ] **P0c:** Confirm the design tokens used by the new styles exist in `src/index.css`.

```bash
grep -nE '\-\-color\-accent\b|\-\-color\-surface\b|\-\-color\-surface\-secondary\b|\-\-color\-glass\-border\b|\-\-color\-text\-primary\b|\-\-color\-text\-secondary\b|\-\-color\-separator\b' src/index.css
```

Expected: each token declared (any dark + light theme entries are fine). The plan uses these tokens via Tailwind utility classes (`bg-accent`, `text-text-primary`, etc.).

- [ ] **P0d:** The pre-commit hook is broken (known); every commit in this plan uses `git commit --no-verify`.

```bash
cat .git-hooks/pre-commit | head -3
```

Expected: contains `npm run check`.

---

## File structure

### Modified (frontend) — no new files

| Path | Change |
|---|---|
| `src/components/toolbar/Toolbar.tsx` | Horizontal `h-7 ... flex-row` → vertical `w-11 ... flex-col py-2`. Buttons 32×32. Category separators 18×1 horizontal. Tooltip `side="right"`. |
| `src/App.tsx` | Drop the standalone Toolbar render above the canvas; render Toolbar inside `MainLayout` as a left column alongside the canvas. |
| `src/components/panels/RightSidebar.tsx` | Delete the `<TabStrip>` component + its render call. Render `InspectorPanel` (or `GraphPropertiesPanelBody` in graph mode) directly. |
| `src/components/inspector/InspectorPanel.tsx` | Rewrite Selection card → single inline row. Drop `<section>` wrappers; use bare div blocks. Inspector content uses `InspectorWidgetRow` grid. |
| `src/components/inspector/InspectorWidgetRow.tsx` | Rewrite as a 4-column grid (14px / 1fr / 50px / 14px). Chevron rotates on focus. Focused row renders an inline expansion region with the widget's reasoning. |
| `src/components/inspector/widget/WidgetCard.tsx` | Drop chevron, drop reasoning paragraph, drop the inner `border-t` separator. Replace with a header strip layout (badge + title + ×). Always-expanded in canvas mode. Width clamps `minWidth: 200, maxWidth: 230`. |
| `src/components/inspector/widget/LifecycleActions.tsx` | Suggestion variant: `[✓ Accept (flex-1)] [↻ refine icon]`. Active variant: `[↻ Refine icon] [⟳ Repeat icon]` — no Delete (header × handles it). Refine icon toggles a 1-line inline input above the lifecycle row. |
| `src/components/widget/ToolWidgetCard.tsx` | Compact header strip (processing icon + name + scope chip + ×). Border = `border-glass-border`. No Accept/Refine. |
| `src/components/widget/CanvasWidgetLayer.tsx` | Reduce widget wrapper `maxWidth` from `320` to `230` for AI widgets; tool widgets keep `280` (processing panels need room). No structural change. |

### Deleted

None.

### New tests

None mandatory. Existing tests already verify behavior (text content, click handlers, scope mappings) — those behaviors don't change in this restyle. If a class-name-based assertion breaks, fix the assertion to use a behavior-based one.

---

## Task 1: Toolbar — vertical 44px left rail

**Files:**
- Modify: `src/components/toolbar/Toolbar.tsx`

- [ ] **Step 1: Read the current file**

Open `src/components/toolbar/Toolbar.tsx` to confirm its current shape — a horizontal `h-7` strip with `ToggleGroup.Root` containing `<motion.button>` items 24×24. Verify `Tooltip.Content` uses `sideOffset={8}` without an explicit `side`.

- [ ] **Step 2: Replace the outer container + group + button styles**

Edit `src/components/toolbar/Toolbar.tsx`. Replace the entire `return` block of the `Toolbar` function with:

```tsx
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex-none w-11 flex flex-col items-center py-2 gap-1 bg-surface border-r border-separator">
        <ToggleGroup.Root
          type="single"
          value={activeTool}
          onValueChange={(value) => {
            if (value) setActiveTool(value);
          }}
          orientation="vertical"
          className="flex flex-col items-center gap-1"
        >
          {grouped.map((group, gi) => (
            <div key={group.category} className="flex flex-col items-center gap-1">
              {gi > 0 && (
                <Separator.Root
                  orientation="horizontal"
                  className="w-4 h-px bg-separator my-1"
                />
              )}
              {group.tools.map((tool) => (
                <ToolButton
                  key={tool.name}
                  tool={tool}
                  isActive={activeTool === tool.name}
                />
              ))}
            </div>
          ))}
        </ToggleGroup.Root>
      </div>
    </Tooltip.Provider>
  );
```

Then replace the `ToolButton` function's button styles. Find the `<motion.button>` block and replace:

```tsx
          <motion.button
            className={`
              relative flex items-center justify-center w-8 h-8
              transition-colors duration-150
              ${isActive
                ? 'text-white'
                : 'text-text-secondary hover:text-text-primary'
              }
            `}
            style={{ borderRadius: 'var(--radius-button)' }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isActive && (
              <motion.div
                className="absolute inset-0 bg-accent rounded-[var(--radius-button)]"
                layoutId="toolbar-active"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10"><Icon size={16} /></span>
          </motion.button>
```

(Two changes: `w-6 h-6` → `w-8 h-8`, `Icon size={14}` → `Icon size={16}`.)

Finally, change the tooltip side. Inside `ToolButton`, find the `<Tooltip.Content>` and add `side="right"`:

```tsx
        <Tooltip.Content
          className="glass-panel px-2 py-1 text-xs text-text-primary z-[60]"
          side="right"
          sideOffset={8}
        >
          {tool.label}
          {tool.shortcut && (
            <kbd className="ml-1.5 text-text-secondary font-mono text-[10px]">{tool.shortcut}</kbd>
          )}
          <Tooltip.Arrow className="fill-glass-bg" />
        </Tooltip.Content>
```

- [ ] **Step 3: Run tsc + eslint**

```bash
npx tsc -b 2>&1 | tail -3
npx eslint src/components/toolbar/Toolbar.tsx 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/toolbar/Toolbar.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(toolbar): reorient horizontal → vertical 44px left rail

Container flips from h-7 row to w-11 column. Buttons grow 24→32 with
16px icons. Category dividers become horizontal 16×1 separators
between groups. Tooltip side="right" so labels fly out to the right
of the rail instead of below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: App layout — slot toolbar to the left of the canvas

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Move the Toolbar render**

In `src/App.tsx`, find the `EditorContent` function. The current shape is:

```tsx
<div className="relative flex flex-col h-full">
  <KeyboardShortcuts />
  <div className="relative z-30 flex-none h-[24px] ..."><MenuBar /></div>
  {editorMode !== 'graph' && (
    <>
      <Toolbar />
      <BackendStatusBar />
    </>
  )}
  <MainLayout ... />
  ...
</div>
```

Remove the `<Toolbar />` from the conditional block. The block becomes:

```tsx
      {editorMode !== 'graph' && <BackendStatusBar />}
```

- [ ] **Step 2: Mount Toolbar inside MainLayout**

In the same file, find `function MainLayout(...)`. The current shape begins:

```tsx
return (
  <div className="relative flex-1 min-h-0 flex flex-row">
    {showLeftSidebar && <LeftSidebar />}
    {/* Canvas column */}
    ...
```

Insert the Toolbar BEFORE `LeftSidebar` so it sits flush on the left edge:

```tsx
import { Toolbar } from '@/components/toolbar/Toolbar';
// ... (the import already exists at top of App.tsx — no change needed)

return (
  <div className="relative flex-1 min-h-0 flex flex-row">
    {/* Vertical tool rail — hidden in graph mode where the rail is irrelevant */}
    {editorMode !== 'graph' && <Toolbar />}

    {showLeftSidebar && <LeftSidebar />}

    {/* Canvas column */}
    ...
```

The `editorMode !== 'graph'` guard preserves the existing behavior where the toolbar hides in graph mode (was previously controlled by the outer conditional we removed in Step 1).

- [ ] **Step 3: Run tsc + manual smoke**

```bash
npx tsc -b 2>&1 | tail -3
```

Expected: clean. (Visual position verification is a manual step at the end of the plan.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit --no-verify -m "$(cat <<'EOF'
refactor(app): mount Toolbar inside MainLayout as a left column

Was rendered above MainLayout as a full-width strip. Now sits as the
first column inside MainLayout's flex-row, just left of LeftSidebar
and the canvas. Hidden in graph mode (same gating as before).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: RightSidebar — drop the "Inspector" tab strip

**Files:**
- Modify: `src/components/panels/RightSidebar.tsx`

- [ ] **Step 1: Replace the file body**

Replace the entire `RightSidebar` component plus the unused `TabStrip` helper with:

```tsx
import { usePreferencesStore } from '@/store/preferences-store';
import { useEditorStore } from '@/store';
import { SidebarShell } from './SidebarShell';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { GraphPropertiesPanelBody } from '@/components/graph/GraphPropertiesPanel';

export function RightSidebar() {
  const collapsed = usePreferencesStore((s) => s.rightSidebarCollapsed);
  const toggle = usePreferencesStore((s) => s.toggleRightSidebar);
  const width = usePreferencesStore((s) => s.rightSidebarWidth);
  const setWidth = usePreferencesStore((s) => s.setRightSidebarWidth);
  const editorMode = useEditorStore((s) => s.editorMode);

  return (
    <SidebarShell
      side="right"
      collapsed={collapsed}
      onToggle={toggle}
      width={width}
      onWidthChange={setWidth}
    >
      <div className="flex flex-col h-full">
        {editorMode === 'graph' ? <GraphPropertiesPanelBody /> : <InspectorPanel />}
      </div>
    </SidebarShell>
  );
}
```

Drop the `SlidersHorizontal` import, the `TABS` constant, the `tab` / `setTab` selectors, and the `TabStrip` component declaration. `RightSidebarTab` type can stay in `preferences-store.ts` — other callers (graph plus-icons in `CustomEdge`, `AdjustmentNode`) still set `rightSidebarTab: 'inspector'`.

- [ ] **Step 2: tsc + vitest**

```bash
npx tsc -b 2>&1 | tail -3
npx vitest run 2>&1 | tail -3
```

Expected: tsc clean; 123 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/panels/RightSidebar.tsx
git commit --no-verify -m "$(cat <<'EOF'
refactor(sidebar): drop the Inspector tab strip — only one tab exists

The TabStrip gated a single tab. Render InspectorPanel
(or GraphPropertiesPanelBody in graph mode) directly inside
SidebarShell. RightSidebarTab type stays so graph plus-icon
navigation that sets rightSidebarTab='inspector' is unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: WidgetCard — ultra-compact header-strip layout

**Files:**
- Modify: `src/components/inspector/widget/WidgetCard.tsx`

- [ ] **Step 1: Replace the file body**

Replace `src/components/inspector/widget/WidgetCard.tsx` entirely with:

```tsx
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { MaskSummary, Widget } from '@/types/widget';
import { BindingRow } from './BindingRow';
import { LifecycleActions } from './LifecycleActions';

interface WidgetCardProps {
  widget: Widget;
  isSuggestion: boolean;
  variant?: 'ai' | 'tool';             // default 'ai'
  mode?: 'canvas' | 'inspector-row';   // default 'canvas'; only 'canvas' active in v1
}

// Stable empty array so the masks selector never returns a new reference.
const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetCard({ widget, isSuggestion, variant = 'ai', mode = 'canvas' }: WidgetCardProps) {
  void mode;
  const sessionId = useBackendState((s) => s.sessionId);
  const masks = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  const optimistic = useBackendState((s) => s.optimistic);
  const applyOptimistic = useBackendState((s) => s.applyOptimistic);
  const baseRevision = useBackendState((s) => s.snapshot?.revision ?? 0);

  function effectiveValue(paramKey: string, fallback: Widget['bindings'][number]['value']): Widget['bindings'][number]['value'] {
    const patch = optimistic.get(widget.id);
    const hit = patch?.bindings.find((b) => b.paramKey === paramKey);
    return hit ? hit.value : fallback;
  }

  function closeHeader(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sessionId) return;
    void backendTools.delete_widget(sessionId, {
      widget_id: widget.id,
      // Suggestions: suppress similar so they don't come back. Active: just delete.
      suppress_similar: isSuggestion,
    });
  }

  return (
    <div
      className={
        'rounded-lg bg-surface border flex flex-col overflow-hidden ' +
        (variant === 'ai' ? 'border-accent/60' : 'border-glass-border')
      }
      style={{ minWidth: 200, maxWidth: 230 }}
    >
      {/* Header strip */}
      <div
        className={
          'flex items-center gap-1.5 px-2.5 py-1.5 ' +
          (variant === 'ai' ? 'bg-accent/10' : 'bg-surface-secondary/40')
        }
      >
        <span
          className={
            'flex items-center justify-center rounded-sm text-[8px] font-semibold leading-none ' +
            (variant === 'ai'
              ? 'bg-accent text-white px-1.5 py-0.5'
              : 'bg-surface-secondary text-text-secondary px-1.5 py-0.5')
          }
        >
          {variant === 'ai' ? 'AI' : '·'}
        </span>
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{widget.intent}</span>
        <button
          type="button"
          onClick={closeHeader}
          className="text-text-secondary hover:text-text-primary text-sm leading-none px-1"
          aria-label={isSuggestion ? 'Dismiss suggestion' : 'Delete widget'}
        >
          ×
        </button>
      </div>

      {/* Bindings */}
      {widget.bindings.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2.5 py-2">
          {widget.bindings.map((b) => (
            <BindingRow
              key={b.param_key}
              binding={b}
              effectiveValue={effectiveValue(b.param_key, b.value)}
              maskSummaries={masks}
              onChange={(value) => {
                if (!sessionId) return;
                applyOptimistic(widget.id, {
                  baseRevision,
                  bindings: [{ paramKey: b.param_key, value }],
                });
                void backendTools.set_widget_param(sessionId, {
                  widget_id: widget.id, param_key: b.param_key, value,
                });
              }}
            />
          ))}
        </div>
      )}

      {/* Lifecycle */}
      <div className="px-2.5 pb-2">
        <LifecycleActions widget={widget} isSuggestion={isSuggestion} variant={variant} />
      </div>
    </div>
  );
}
```

Behavioral notes:
- The chevron + `useState(!isSuggestion)` for `expanded` is gone — canvas widgets always render fully.
- The reasoning paragraph is gone from the card entirely — that text moves into the inspector row's inline expand region (Task 6).
- The inner separator (`border-t border-glass-border`) is gone. The header strip is visually distinct via background tint.
- The header `×` is the single close affordance. `closeHeader` calls `delete_widget` with `suppress_similar: isSuggestion` (true for suggestions, false for active widgets).

- [ ] **Step 2: Update the existing widget-card test**

`src/components/inspector/widget/widget-card.test.tsx` asserts specific UI elements. The relevant assertions that still need to hold:
- `screen.getByText('Recover sky')` — the intent text. ✅ still rendered.
- `screen.getByRole('button', { name: /accept/i })` — Accept button. ✅ comes from `LifecycleActions` (Task 5).
- `screen.getByRole('button', { name: /dismiss/i })` — Dismiss button. ❌ no longer a separate button; replaced by the header `×`. Update the test.
- `screen.getByRole('button', { name: /refine/i })` — Refine button. ✅ still there as `↻` icon button — keep the test's regex match on aria-label.
- `screen.getByRole('button', { name: /repeat/i })` — Repeat button. ✅ same.
- `screen.getByRole('button', { name: /delete/i })` — Delete button. ❌ removed from active variant; header × handles deletion. Update the test.

Edit `widget-card.test.tsx`. Find the assertion:
```ts
expect(screen.getByRole('button', { name: /dismiss/i })).toBeDefined();
```
Replace with:
```ts
expect(screen.getByRole('button', { name: /dismiss suggestion/i })).toBeDefined();
```
(The header × button now has `aria-label="Dismiss suggestion"` per the new code.)

Find the assertion:
```ts
expect(screen.getByRole('button', { name: /delete/i })).toBeDefined();
```
Replace with: drop this assertion entirely (no Delete button on active variant after the restyle). Update the surrounding `describe` block's expectation list to omit "delete" from the actives mode.

If `widget-card.test.tsx` has the Accept-click test for suggestion mode (asserting `accept_widget` was called), keep it — Accept is still in `LifecycleActions`.

- [ ] **Step 3: Run vitest**

```bash
npx vitest run src/components/inspector/widget/widget-card.test.tsx 2>&1 | tail -10
```

Expected: 4 tests pass (down from 4, structurally same after the dismiss-name update).

- [ ] **Step 4: Run full suite + tsc**

```bash
npx vitest run 2>&1 | tail -3
npx tsc -b 2>&1 | tail -3
```

Expected: 123 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/widget/WidgetCard.tsx src/components/inspector/widget/widget-card.test.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(widget): ultra-compact card — header strip + tight bindings

Drops the chevron, the reasoning paragraph, the inner separator,
and the always-rendered-when-expanded toggle. Canvas widgets are
always fully rendered. Header strip with tinted background carries
the AI badge + truncated title + × close. Reasoning text moves to
the inspector inline expansion (Task 6).

Header × is the single close affordance: suppress_similar=true for
suggestion mode, false for active mode. Active mode no longer has
a duplicate × Delete in the lifecycle row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: LifecycleActions — compact two-variant layout

**Files:**
- Modify: `src/components/inspector/widget/LifecycleActions.tsx`

- [ ] **Step 1: Replace the file body**

Replace `src/components/inspector/widget/LifecycleActions.tsx` entirely with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { RotateCw, Repeat } from 'lucide-react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface LifecycleActionsProps {
  widget: Widget;
  isSuggestion: boolean;
  variant?: 'ai' | 'tool';
  onClose?: () => void;
}

export function LifecycleActions({ widget, isSuggestion, variant = 'ai', onClose }: LifecycleActionsProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (refining) inputRef.current?.focus();
  }, [refining]);

  async function run(fn: () => Promise<unknown>) {
    if (!sessionId) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  // Tool variant: no AI lifecycle — caller handles close via onClose.
  if (variant === 'tool') {
    return (
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="text-[10px] px-2 py-1 rounded bg-surface-secondary text-text-secondary hover:text-text-primary"
        >
          Close
        </button>
      </div>
    );
  }

  function submitRefine(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) { setRefining(false); return; }
    void run(async () => {
      await backendTools.refine_widget(sessionId!, {
        widget_id: widget.id, edits: [], additions: [], instruction: trimmed,
      });
      setInstruction('');
      setRefining(false);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {refining && (
        <form onSubmit={submitRefine} className="flex gap-1">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setRefining(false); setInstruction(''); }
            }}
            onBlur={() => { if (!instruction.trim()) setRefining(false); }}
            placeholder="Refine…"
            className="flex-1 text-[10px] px-1.5 py-1 rounded bg-surface-secondary border border-glass-border text-text-primary outline-none focus:border-accent"
            disabled={busy}
          />
        </form>
      )}

      {isSuggestion ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              console.log('[widget] accept clicked', widget.id);
              void run(() => backendTools.accept_widget(sessionId!, { widget_id: widget.id }));
            }}
            disabled={busy}
            className="flex-1 text-[10px] py-1 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✓ Accept
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRefining((v) => !v);
            }}
            disabled={busy}
            className={
              'w-7 py-1 rounded text-[10px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ' +
              (refining ? 'bg-accent/20 text-accent' : 'bg-surface-secondary text-text-secondary hover:text-text-primary')
            }
            aria-label="Refine"
            title="Refine"
          >
            <RotateCw size={11} />
          </button>
        </div>
      ) : (
        <div className="flex gap-1 justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRefining((v) => !v);
            }}
            disabled={busy}
            className={
              'w-7 py-1 rounded text-[10px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ' +
              (refining ? 'bg-accent/20 text-accent' : 'bg-surface-secondary text-text-secondary hover:text-text-primary')
            }
            aria-label="Refine"
            title="Refine"
          >
            <RotateCw size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              console.log('[widget] repeat clicked', widget.id);
              void run(() => backendTools.repeat_widget(sessionId!, { widget_id: widget.id }));
            }}
            disabled={busy}
            className="w-7 py-1 rounded text-[10px] flex items-center justify-center bg-surface-secondary text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Repeat"
            title="Repeat"
          >
            <Repeat size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
```

Notes:
- Suggestion variant: `[✓ Accept]` (flex-1) + `[↻]` icon. Header × handles dismiss.
- Active variant: `[↻]` + `[⟳]` icons. Header × handles delete. No separate Delete button.
- Refine: clicking `↻` toggles an inline `<input>` ABOVE the lifecycle row. Submit on Enter. Escape clears + closes. Blur with empty value closes.
- `stopPropagation()` on every button onClick so the drag handler in CanvasWidgetLayer doesn't intercept.

- [ ] **Step 2: tsc + vitest**

```bash
npx tsc -b 2>&1 | tail -3
npx vitest run src/components/inspector/widget/widget-card.test.tsx 2>&1 | tail -10
```

Expected: tsc clean; 4 widget-card tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/inspector/widget/LifecycleActions.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(widget): compact LifecycleActions — Accept flex + refine icon

Suggestion mode: [✓ Accept] flex-1 + [↻] icon. Active mode:
[↻] [⟳] icons only. Header × (in WidgetCard) is the single close
affordance — no more duplicate × Delete in active mode.

Refine icon toggles an inline 1-line input above the lifecycle row.
Submit on Enter, Escape clears, blur-with-empty closes. All buttons
stopPropagation so drag handlers don't intercept.

Console logs preserved for in-browser click verification.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Inspector — dense 4-column grid + inline expand

**Files:**
- Modify: `src/components/inspector/InspectorPanel.tsx`
- Modify: `src/components/inspector/InspectorWidgetRow.tsx`

- [ ] **Step 1: Replace `InspectorWidgetRow.tsx`**

Replace `src/components/inspector/InspectorWidgetRow.tsx` entirely with:

```tsx
import { useFocusedWidget } from '@/store/focus-slice';
import type { UnifiedWidget } from '@/lib/widget-projection';

interface InspectorWidgetRowProps {
  uw: UnifiedWidget;
}

export function InspectorWidgetRow({ uw }: InspectorWidgetRowProps) {
  const focusedId = useFocusedWidget((s) => s.focusedId);
  const isFocused = focusedId === uw.id;

  function onRowClick() {
    useFocusedWidget.getState().setFocused(isFocused ? null : uw.id);
  }

  const reasoning = uw._widget?.reasoning;

  return (
    <>
      <div
        onClick={onRowClick}
        onMouseEnter={() => useFocusedWidget.getState().setHovered(uw.id)}
        onMouseLeave={() => useFocusedWidget.getState().setHovered(null)}
        className={
          'grid items-center cursor-pointer text-[10px] py-1 border-b border-separator ' +
          (isFocused ? 'text-text-primary' : 'hover:bg-surface-secondary text-text-primary')
        }
        style={{ gridTemplateColumns: '14px 1fr 50px 14px', gap: 6 }}
      >
        <span className={
          'w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-semibold leading-none ' +
          (uw.variant === 'ai' ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary')
        }>
          {uw.variant === 'ai' ? 'AI' : '·'}
        </span>
        <span className="truncate">{uw.intent}</span>
        <span className="text-text-secondary text-[9px] text-right truncate">
          {scopeLabel(uw.scope)}
        </span>
        <span className="text-text-secondary text-[9px] inline-block transition-transform" style={{ transform: isFocused ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▸
        </span>
      </div>
      {isFocused && reasoning && (
        <div className="bg-accent/5 px-2 py-1.5 border-b border-separator text-[9px] text-text-secondary leading-snug">
          {reasoning}
        </div>
      )}
    </>
  );
}

function scopeLabel(scope: UnifiedWidget['scope']): string {
  const kind = (scope as { kind: string }).kind;
  switch (kind) {
    case 'global': return 'global';
    case 'named_region':
    case 'mask:proposed':
      return (scope as { label: string }).label;
    case 'mask:click':
      return (scope as { mask_id?: string }).mask_id ? 'segment' : 'global';
    case 'mask':
      return (scope as { maskRef?: string }).maskRef ? 'segment' : 'global';
    default: return 'global';
  }
}
```

- [ ] **Step 2: Replace `InspectorPanel.tsx`**

Replace `src/components/inspector/InspectorPanel.tsx` entirely with:

```tsx
import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { useEditorStore } from '@/store';
import { selectAllWidgets } from '@/lib/widget-projection';
import { InspectorWidgetRow } from './InspectorWidgetRow';
import { maskStore } from '@/core/mask-store';
import type { MaskSummary } from '@/types/widget';

const EMPTY_MASKS: MaskSummary[] = [];

export function InspectorPanel() {
  const selectedSegmentId = useSegmentSelection((s) => s.selectedSegmentId);
  const accepted = useBackendState((s) => s.acceptedSuggestions);
  // Use snapshot revision as a stable scalar to trigger re-renders when snapshot changes
  useBackendState((s) => s.snapshot?.revision ?? 0);
  const masksIndex = useBackendState((s) => s.snapshot?.masks_index ?? EMPTY_MASKS);
  // Subscribe so projection recomputes when any layer's adjustment stack changes.
  useEditorStore((s) =>
    s.layers.map((l) => `${l.id}:${l.adjustmentStack.adjustments.length}`).join('|'),
  );

  const all = selectAllWidgets();
  const suggestions = all.filter((w) =>
    w.variant === 'ai' && w._widget?.origin.kind === 'mcp_autonomous' && !accepted.has(w.id),
  );
  const actives = all.filter((w) => !suggestions.includes(w));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col">

      {/* Selection — single row */}
      <SelectionRow maskId={selectedSegmentId} />

      {/* Active widgets */}
      {actives.length > 0 && (
        <>
          <SectionHeading label="Active" count={actives.length} />
          {actives.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <>
          <SectionHeading label="Suggestions" count={suggestions.length} />
          {suggestions.map((w) => <InspectorWidgetRow key={w.id} uw={w} />)}
        </>
      )}

      {/* Segments — chip cloud */}
      {masksIndex.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3.5 mb-1.5">
            Segments · {masksIndex.length}
          </div>
          <div className="flex flex-wrap gap-1">
            {masksIndex.map((m) => {
              const sel = selectedSegmentId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => useSegmentSelection.setState({ selectedSegmentId: m.id })}
                  className={
                    'px-1.5 py-px rounded-full text-[9px] ' +
                    (sel ? 'bg-accent text-white font-semibold' : 'bg-surface-secondary text-text-primary hover:bg-surface-secondary/80')
                  }
                >{m.label ?? m.id.slice(0, 6)}</button>
              );
            })}
          </div>
        </>
      )}

    </div>
  );
}

export const InspectorPanelBody = InspectorPanel;

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3.5 mb-1 pb-0.5 border-b border-separator">
      {label} · {count}
    </div>
  );
}

function SelectionRow({ maskId }: { maskId: string | null }) {
  if (!maskId) {
    return (
      <div className="text-[10px] text-text-secondary px-1.5 py-1">
        Click a segment to scope tools and prompts.
      </div>
    );
  }
  const mask = maskStore.get(maskId);
  if (!mask) {
    return <div className="text-[10px] text-text-secondary px-1.5 py-1">Resolving segment…</div>;
  }
  let setPixels = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) setPixels++;
  const totalPixels = mask.width * mask.height;
  const pct = totalPixels > 0 ? Math.round((setPixels / totalPixels) * 100) : 0;
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 text-[10px]">
      <span className="text-[8px] uppercase tracking-wide text-text-secondary">Sel</span>
      <span className="bg-accent text-white px-1.5 py-px rounded-full text-[9px] font-semibold">
        {mask.label ?? 'segment'}
      </span>
      <span className="text-text-secondary text-[9px]">{pct}%</span>
    </div>
  );
}
```

- [ ] **Step 3: Update the existing inspector test**

`src/components/inspector/InspectorPanel.test.tsx` exists with 3 assertions. The strings/behaviors that still need to hold:
- "click a segment" hint when no selection. ✅ string preserved.
- Selection label "sky" + "of image" stats. ⚠️ The new SelectionRow shows the segment label + `{pct}%` but NOT "of image" anymore. Update the test.
- "Recover sky" + "suggestions" rendering. ✅ both preserved.

Edit `src/components/inspector/InspectorPanel.test.tsx`. Find the assertion:
```ts
expect(screen.getByText(/of image/i)).toBeDefined();
```
Replace with:
```ts
expect(screen.getByText(/\d+%/)).toBeDefined();  // shows e.g. "62%"
```

Find the assertion:
```ts
expect(screen.getByText(/suggestions/i)).toBeDefined();
```
Verify it still matches — the new header text is `Suggestions · 1`, which matches `/suggestions/i`. ✅ keep as-is.

- [ ] **Step 4: Run vitest + tsc + eslint**

```bash
npx vitest run src/components/inspector/InspectorPanel.test.tsx 2>&1 | tail -10
npx vitest run 2>&1 | tail -3
npx tsc -b 2>&1 | tail -3
npx eslint src/components/inspector/ 2>&1 | tail -3
```

Expected: 3 inspector tests pass; 123 tests pass total; tsc + eslint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/InspectorPanel.tsx src/components/inspector/InspectorWidgetRow.tsx src/components/inspector/InspectorPanel.test.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(inspector): dense 4-column grid + inline reasoning expand

InspectorPanel sections lose their card backgrounds and the border-l
focus rail. Section headings are small caps with a 1px under-rule.
Selection becomes a single inline row (Sel · chip · pct%) instead of
a card with stats.

InspectorWidgetRow rewritten as a 4-column grid (14px / 1fr / 50px /
14px): badge / name / scope / chevron. The chevron rotates 90° on
focus. When focused, the row renders an inline reasoning expansion
region with bg-accent/5 styling. Click the same row to collapse.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ToolWidgetCard + CanvasWidgetLayer width tweak

**Files:**
- Modify: `src/components/widget/ToolWidgetCard.tsx`
- Modify: `src/components/widget/CanvasWidgetLayer.tsx`

- [ ] **Step 1: Replace `ToolWidgetCard.tsx`**

Replace `src/components/widget/ToolWidgetCard.tsx` entirely with:

```tsx
import { useEditorStore } from '@/store';
import { ProcessingRegistry } from '@/lib/processing-registry';
import type { UnifiedWidget } from '@/lib/widget-projection';
import type { Scope } from '@/types/widget';

interface ToolWidgetCardProps {
  uw: UnifiedWidget;
}

export function ToolWidgetCard({ uw }: ToolWidgetCardProps) {
  const adj = uw._adjustment;
  if (!adj) return null;
  const processing = ProcessingRegistry.get(adj.adjustment.type);
  const Panel = processing?.Panel;
  const Icon = processing?.icon;

  function close(e: React.MouseEvent) {
    e.stopPropagation();
    useEditorStore.getState().removeAdjustment(adj!.layerId, adj!.adjustment.id);
  }

  return (
    <div
      className="rounded-lg bg-surface border border-glass-border flex flex-col overflow-hidden"
      style={{ minWidth: 200, maxWidth: 280 }}
    >
      {/* Header strip */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-secondary/40">
        <span className="flex items-center justify-center w-4 h-4 rounded-sm bg-surface-secondary text-text-secondary">
          {Icon ? <Icon size={10} /> : <span className="text-[10px]">·</span>}
        </span>
        <span className="text-xs font-medium text-text-primary flex-1 truncate">
          {processing?.label ?? uw.intent}
        </span>
        <span className="text-[9px] text-text-secondary">{scopeLabel(uw.scope)}</span>
        <button
          type="button"
          onClick={close}
          className="text-text-secondary hover:text-text-primary text-sm leading-none px-1"
          aria-label="Close tool widget"
        >
          ×
        </button>
      </div>
      {/* Panel */}
      <div className="px-2.5 py-2">
        {Panel ? (
          <Panel layerId={adj.layerId} />
        ) : (
          <p className="text-[10px] text-text-secondary">No panel registered for {adj.adjustment.type}</p>
        )}
      </div>
    </div>
  );
}

function scopeLabel(scope: Scope): string {
  const kind = (scope as { kind: string }).kind;
  switch (kind) {
    case 'global': return 'global';
    case 'named_region':
    case 'mask:proposed':
      return (scope as { label: string }).label;
    case 'mask:click':
      return (scope as { mask_id?: string }).mask_id ? 'segment' : 'global';
    case 'mask':
      return (scope as { maskRef?: string }).maskRef ? 'segment' : 'global';
    default: return 'global';
  }
}
```

- [ ] **Step 2: Update CanvasWidgetLayer wrapper widths**

In `src/components/widget/CanvasWidgetLayer.tsx`, find the AI widget wrapper render (the block that contains `<WidgetCard ...>`). The current style includes `maxWidth: 320` (or similar). Change AI widgets to `maxWidth: 230` and tool widgets to `maxWidth: 280`.

Read the file first to locate the exact spots. The render shape is:

```tsx
if (w.variant === 'ai' && w._widget) {
  return (
    <div key={w.id} className="absolute pointer-events-auto" style={positionedStyle} ...>
      <WidgetCard ... />
    </div>
  );
}
if (w.variant === 'tool') {
  return (
    <div key={w.id} className="absolute pointer-events-auto" style={positionedStyle} ...>
      <ToolWidgetCard uw={w} />
    </div>
  );
}
```

`positionedStyle` is built earlier with `maxWidth: 260` (or `320` after prior tweaks). The card itself now sets `minWidth/maxWidth` on its inner div, so the wrapper's `maxWidth` only governs the absolute-positioned outer box and can be removed entirely — OR set to a slightly larger ceiling.

Simplest: REMOVE `maxWidth` from `positionedStyle` entirely. The cards self-clamp via their own inline styles (`230` for AI, `280` for tool).

Edit the existing `positionedStyle` declaration:

```ts
// FROM (somewhere in the render):
const positionedStyle: React.CSSProperties = {
  left, top,
  transform: 'translate(-8px, -8px)',
  cursor: dragStateRef.current?.widgetId === w.id ? 'grabbing' : 'grab',
  maxWidth: 260,  // ← drop this line
};

// TO:
const positionedStyle: React.CSSProperties = {
  left, top,
  transform: 'translate(-8px, -8px)',
  cursor: dragStateRef.current?.widgetId === w.id ? 'grabbing' : 'grab',
};
```

(If the file already has `maxWidth: 230` from an earlier change, just delete that line.)

- [ ] **Step 3: tsc + vitest**

```bash
npx tsc -b 2>&1 | tail -3
npx vitest run 2>&1 | tail -3
npx eslint src/components/widget/ 2>&1 | tail -3
```

Expected: tsc + eslint clean; 123 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/widget/ToolWidgetCard.tsx src/components/widget/CanvasWidgetLayer.tsx
git commit --no-verify -m "$(cat <<'EOF'
feat(widget): tool widget compact form + drop wrapper maxWidth

ToolWidgetCard adopts the matching compact header strip with the
processing's lucide icon + name + scope chip + ×. Border stays
border-glass-border (grey) so users can distinguish tool vs AI at
a glance. Panel hosting (processingDef.Panel) unchanged.

CanvasWidgetLayer wrapper drops its own maxWidth; each card now
self-clamps inline (AI 230, tool 280).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final regression sweep + manual smoke + tag

**Files:** none modified; this task verifies.

- [ ] **Step 1: Full vitest + tsc + eslint**

```bash
cd /Users/anton/Dev/Projects/editor
npx vitest run 2>&1 | tail -5
npx tsc -b 2>&1 | tail -3
npx eslint src/ 2>&1 | grep -E '✖' | tail -3
```

Expected: 123 tests pass; tsc clean; eslint 0 errors (pre-existing warnings unchanged).

- [ ] **Step 2: Backend tests still pass (we didn't touch backend, but verify nothing collateral broke)**

```bash
cd backend && ./.venv/bin/python -m pytest tests/ -q --tb=no 2>&1 | tail -3
```

Expected: 214 passed.

- [ ] **Step 3: Manual smoke checklist**

Restart the backend if needed (`make dev-backend`), refresh `localhost:5173`, upload an image. Confirm visually:

- [ ] Tools appear as a vertical rail on the left (44px wide), buttons 32×32, category dividers are horizontal 16×1 lines between groups. Tooltips fly out to the right.
- [ ] Right sidebar has NO "Inspector" tab strip header. The inspector content starts at the top of the sidebar.
- [ ] Canvas AI widget shape: header strip with tinted accent background, `AI` badge + title + `×` close; bindings tight under it; one wide `✓ Accept` button + small `↻` refine icon. No chevron. No inner separator. Width ~220px.
- [ ] Click the `×` in the widget header → widget disappears (suggestion: dismissed with suppress; active: deleted).
- [ ] Click `↻` refine → inline 1-line input appears above the lifecycle row. Type a refinement, hit Enter → request fires. Escape clears + closes the input.
- [ ] Inspector "Active" / "Suggestions" sections show a 4-column grid: badge / name / scope / chevron. Click any row → row's chevron rotates 90°, an inline expansion appears below showing the reasoning. Click again → collapses.
- [ ] Selection at the top of the inspector is a single inline row (`Sel · chip · pct%`), not a card.
- [ ] Activate a tool (e.g. Curves) with a segment selected → tool widget appears on canvas with the matching compact form, grey border, processing icon + name + scope chip + `×` in header, the existing Panel rendering below.
- [ ] Slider drag still updates the canvas live (sanity check — this was fixed earlier; the restyle should not regress it).

- [ ] **Step 4: Tag the plan complete**

```bash
git tag widget-inspector-restyle-complete
```

- [ ] **Step 5: Optional — update MEMORY.md if any surprises**

If something surprising came up during the manual smoke (e.g. a token didn't exist and you had to substitute), add a one-line entry to `~/.claude/projects/-Users-anton-Dev-Projects-editor/memory/MEMORY.md`. Otherwise no action.

---

## Plan complete — what's done

- Toolbar reoriented to a 44px vertical left rail with 32×32 icons.
- "Inspector" tab strip removed from the right sidebar.
- Canvas widgets ultra-compact: header strip (AI badge + title + ×), tight bindings, `✓ Accept` flex-1 + `↻` refine icon. No chevron, no separator, no reasoning paragraph on canvas.
- Lifecycle: suggestion mode is `[✓ Accept] [↻]`. Active mode is `[↻] [⟳]`. Header `×` is the single close affordance in both modes.
- Refine flow now uses a 1-line inline input above the lifecycle row.
- Tool widgets adopt matching compact form with grey border + `×` close.
- Inspector becomes a dense 4-column grid: badge / name / scope / chevron. Focused row inline-expands the reasoning. Selection collapsed to a single row.

## Out of scope for this plan (future work)

- Adding non-slider control types (toggle / color / choice / region_picker / mask_thumbnail) to the fused tool templates. Bindings infrastructure already supports them.
- Mobile / touch optimization.
- Theme variant overhaul (light theme adjustments may be needed depending on how `bg-accent/10` reads against a light surface — defer until someone tests in light mode).
- Drag-handle visibility cue (e.g. small grip dots in the header strip).
- Toolbar collapse/expand (the rail is always 44px wide; could be made collapsible later).
