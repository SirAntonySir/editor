# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left toolrail with a Raycast-style command palette as the single tool-opening surface (⌘K + a discreet ＋ trigger).

**Architecture:** A Radix Dialog overlay (`CommandPalette`) lists the 6 adjustment tools as named, fuzzy-searchable commands plus an AI-prompt row. Pure list/target logic lives in a testable `command-palette.ts` helper; execution reuses the existing `spawnToolWidget` (origin `tool_invoked`) and `proposeFromPalette` (origin `mcp_user_prompt`) paths unchanged. A target chip shows the destination ImageNode; Tab cycles it; a single node is auto-selected.

**Tech Stack:** React 19, TypeScript (strict), Zustand, Radix Dialog (`@radix-ui/react-dialog`, already installed), Framer Motion, Tailwind, Vitest + Testing Library + jsdom.

---

## Background Facts (verified in codebase)

- **Tools** are registered on `CanvasToolRegistry` (singleton) in `src/App.tsx:46-51`. The 6 adjustment tools and their `processingId`:
  | `name` | `label` | `processingId` |
  |---|---|---|
  | `light` | Light | `light` |
  | `color` | Color | `color` |
  | `kelvin` | White Balance | `kelvin` |
  | `curves` | Curves | `curves` |
  | `levels` | Levels | `levels` |
  | `filters` | Filters | `filter` ← note: not `filters` |
- `CanvasToolRegistry.getAll(): ToolDefinition[]` returns tools in registration order. `ToolDefinition` has `{ name, label, icon: ComponentType<{size?:number}>, category, processingId?, shortcut? }` (`src/types/tool.ts:39-67`). There is **no `description` field** — the palette derives a short description from a local map.
- **Execution paths (reuse, do NOT modify):**
  - `spawnToolWidget(toolName: string): boolean` (`src/lib/toolrail-spawn.ts`) — reads `activeImageNodeId` from the store, gates with a toast if absent, resolves `layer_id`, calls `propose_widget(origin:'tool_invoked')`. Pass the tool's **`name`** (it looks up `processingId` itself).
  - `proposeFromPalette(text, scope)` (`src/lib/palette-actions.ts`) — calls `propose_widget(origin:'mcp_user_prompt')`.
- **Target store:** `imageNodes: Record<string, ImageNodeState>` where `ImageNodeState = { id, layerIds: string[], position, size }` — **no name field**. `activeImageNodeId: string | null`. Setter: `setActiveImageNode(id | null)` (`src/store/workspace-slice.ts:170`), called directly from canvas selection (`CanvasWorkspace.tsx:233`) — safe to call directly here.
- **Layer names:** `layers: Layer[]` with `Layer.name` (`src/store/layer-slice.ts`). Target chip label = name of the node's first layer, fallback to node id.
- **⌘K wiring:** `src/App.tsx:136-147` (`EditorContent`) dispatches `window` CustomEvent `spawn-palette:open` (gated on `sseStatus === 'open'`). Currently consumed by `AskAiInput` (`src/components/inspector/AskAiInput.tsx:13`).
- **Removals:** `<Toolbar />` rendered only at `src/App.tsx:69` (import `:7`). `<AskAiInput />` rendered only at `src/components/inspector/SuggestionsSection.tsx:57` (import `:7`). **No test files** exist for either.
- **Overlay style:** `.overlay` CSS class (`src/index.css`) = surface bg + strong border + overlay shadow + panel radius. Radix Dialog skeleton: mirror `src/components/EditorDialog.tsx`.
- **Toast:** `import { toast } from '@/components/ui/Toast'`; `toast.info('…')`.

## File Structure

**Create:**
- `src/lib/command-palette.ts` — pure helpers: `PaletteCommand` type, `buildToolCommands`, `filterCommands`, `imageNodeLabel`, `resolveInitialTargetId`, `nextTargetId`.
- `src/lib/command-palette.test.ts` — unit tests for the above.
- `src/components/ui/CommandTrigger.tsx` — the discreet ＋ button (dispatches `spawn-palette:open`, disabled when SSE not open).
- `src/components/ui/CommandTrigger.test.tsx` — render + dispatch/disabled tests.
- `src/components/CommandPalette.tsx` — scaffold Dialog overlay (search, sections, target chip, keyboard, execution). Module-scope `CommandRow` sibling (no nested components).
- `src/components/CommandPalette.test.tsx` — component tests (open via event, gate, filter, execute).

**Modify:**
- `src/App.tsx` — drop `Toolbar` import/render; mount `<CommandPalette />` in `EditorContent`; render `<CommandTrigger />` where `<Toolbar />` was; update ⌘K comment.
- `src/components/inspector/SuggestionsSection.tsx` — drop `AskAiInput` import + render.

**Delete:**
- `src/components/toolbar/Toolbar.tsx`
- `src/components/inspector/AskAiInput.tsx`

---

## Task 1: Pure command-palette helpers

**Files:**
- Create: `src/lib/command-palette.ts`
- Test: `src/lib/command-palette.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/command-palette.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildToolCommands,
  filterCommands,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
} from './command-palette';
import type { ToolDefinition } from '@/types/tool';
import type { ImageNodeState } from '@/types/workspace';
import type { Layer } from '@/store/layer-slice';

const Icon = () => null;
const tool = (name: string, label: string, processingId?: string): ToolDefinition =>
  ({ name, label, icon: Icon, category: 'adjust', processingId }) as ToolDefinition;

describe('buildToolCommands', () => {
  it('keeps only tools with a processingId and maps them to commands', () => {
    const tools = [tool('light', 'Light', 'light'), tool('move', 'Move')];
    const cmds = buildToolCommands(tools);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ id: 'tool:light', kind: 'tool', toolName: 'light', label: 'Light' });
    expect(typeof cmds[0].description).toBe('string');
  });
});

describe('filterCommands', () => {
  const cmds = buildToolCommands([
    tool('light', 'Light', 'light'),
    tool('curves', 'Curves', 'curves'),
    tool('color', 'Color', 'color'),
  ]);
  it('returns all commands for an empty query', () => {
    expect(filterCommands(cmds, '')).toHaveLength(3);
  });
  it('matches case-insensitively on label substring', () => {
    expect(filterCommands(cmds, 'cur').map((c) => c.toolName)).toEqual(['curves']);
  });
  it('returns empty when nothing matches', () => {
    expect(filterCommands(cmds, 'zzz')).toEqual([]);
  });
});

describe('imageNodeLabel', () => {
  const node = (id: string, layerIds: string[]): ImageNodeState =>
    ({ id, layerIds, position: { x: 0, y: 0 }, size: { w: 1, h: 1 } });
  const layer = (id: string, name: string): Layer =>
    ({ id, name, type: 'raster', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }) as Layer;
  it("uses the node's first layer name", () => {
    expect(imageNodeLabel(node('in-1', ['l1']), [layer('l1', 'Foto.jpg')])).toBe('Foto.jpg');
  });
  it('falls back to the node id when no layer matches', () => {
    expect(imageNodeLabel(node('in-2', ['lx']), [])).toBe('in-2');
  });
});

describe('resolveInitialTargetId', () => {
  it('prefers the active id when present', () => {
    expect(resolveInitialTargetId(['in-1', 'in-2'], 'in-2')).toBe('in-2');
  });
  it('auto-selects the only node when none active', () => {
    expect(resolveInitialTargetId(['in-9'], null)).toBe('in-9');
  });
  it('falls back to the first node for multiple with none active', () => {
    expect(resolveInitialTargetId(['in-1', 'in-2'], null)).toBe('in-1');
  });
  it('returns null when there are no nodes', () => {
    expect(resolveInitialTargetId([], null)).toBeNull();
  });
});

describe('nextTargetId', () => {
  it('cycles to the next id and wraps around', () => {
    expect(nextTargetId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextTargetId(['a', 'b', 'c'], 'c')).toBe('a');
  });
  it('returns the only id unchanged', () => {
    expect(nextTargetId(['a'], 'a')).toBe('a');
  });
  it('returns the first id when current is unknown/null', () => {
    expect(nextTargetId(['a', 'b'], null)).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/command-palette.test.ts`
Expected: FAIL — `Cannot find module './command-palette'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/command-palette.ts
import type { ComponentType } from 'react';
import type { ToolDefinition } from '@/types/tool';
import type { ImageNodeState } from '@/types/workspace';
import type { Layer } from '@/store/layer-slice';

export interface PaletteCommand {
  id: string;
  kind: 'tool' | 'ai';
  label: string;
  description: string;
  icon?: ComponentType<{ size?: number }>;
  /** Present for `kind: 'tool'` — the registry tool name to spawn. */
  toolName?: string;
}

/** Short, human descriptions per tool name. Keyed by ToolDefinition.name. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  light: 'Exposure, contrast, highlights, shadows',
  color: 'Saturation, vibrance, hue',
  kelvin: 'White balance / temperature',
  curves: 'RGB curves',
  levels: 'Levels with histogram',
  filters: 'LUT colour grading',
};

export function buildToolCommands(tools: ToolDefinition[]): PaletteCommand[] {
  return tools
    .filter((t) => !!t.processingId)
    .map((t) => ({
      id: `tool:${t.name}`,
      kind: 'tool' as const,
      label: t.label,
      description: TOOL_DESCRIPTIONS[t.name] ?? '',
      icon: t.icon,
      toolName: t.name,
    }));
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  );
}

export function imageNodeLabel(node: ImageNodeState, layers: Layer[]): string {
  const firstLayerId = node.layerIds[0];
  const layer = layers.find((l) => l.id === firstLayerId);
  return layer?.name ?? node.id;
}

export function resolveInitialTargetId(ids: string[], activeId: string | null): string | null {
  if (activeId && ids.includes(activeId)) return activeId;
  if (ids.length === 0) return null;
  return ids[0];
}

export function nextTargetId(ids: string[], currentId: string | null): string {
  if (ids.length === 0) return '';
  const idx = currentId ? ids.indexOf(currentId) : -1;
  return ids[(idx + 1) % ids.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/command-palette.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/command-palette.ts src/lib/command-palette.test.ts
git commit -m "feat(palette): pure command-list and target helpers"
```

---

## Task 2: CommandTrigger primitive (the ＋ button)

**Files:**
- Create: `src/components/ui/CommandTrigger.tsx`
- Test: `src/components/ui/CommandTrigger.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/CommandTrigger.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandTrigger } from './CommandTrigger';
import { useBackendState } from '@/store/backend-state-slice';

beforeEach(() => useBackendState.getState().reset());
afterEach(() => cleanup());

describe('CommandTrigger', () => {
  it('dispatches spawn-palette:open on click when SSE is open', async () => {
    useBackendState.setState({ sseStatus: 'open' });
    const spy = vi.fn();
    window.addEventListener('spawn-palette:open', spy);
    render(<CommandTrigger />);
    await userEvent.click(screen.getByRole('button', { name: /open command palette/i }));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('spawn-palette:open', spy);
  });

  it('is disabled when SSE is not open', () => {
    useBackendState.setState({ sseStatus: 'connecting' });
    render(<CommandTrigger />);
    expect(screen.getByRole('button', { name: /open command palette/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/CommandTrigger.test.tsx`
Expected: FAIL — `Cannot find module './CommandTrigger'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/CommandTrigger.tsx
import { Plus } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';

/** Discreet entry point that opens the command palette (mirrors ⌘K).
 *  Sits where the old toolrail lived. Disabled when the backend is not connected. */
export function CommandTrigger() {
  const sseStatus = useBackendState((s) => s.sseStatus);
  const disabled = sseStatus !== 'open';

  return (
    <div className="flex-none w-10 flex flex-col items-end justify-end py-2 px-1.5 bg-surface border-r border-separator">
      <button
        type="button"
        aria-label="Open command palette"
        title="Open command palette (⌘K)"
        disabled={disabled}
        onClick={() => window.dispatchEvent(new CustomEvent('spawn-palette:open'))}
        className={`flex items-center justify-center w-7 h-7 transition-colors duration-150
          ${disabled
            ? 'text-text-secondary opacity-30 cursor-not-allowed'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'}`}
        style={{ borderRadius: 'var(--radius-button)' }}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/CommandTrigger.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/CommandTrigger.tsx src/components/ui/CommandTrigger.test.tsx
git commit -m "feat(palette): discreet ＋ command trigger primitive"
```

---

## Task 3: CommandPalette — open, gate, search, target chip

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Test: `src/components/CommandPalette.test.tsx`

This task builds the overlay shell: listens for `spawn-palette:open`, gates (SSE open + ≥1 image node, else toast), renders search input, the target chip, and the filtered Adjustments + AI sections. Execution wiring is added in Task 4.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/CommandPalette.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { LightTool } from '@/tools/light-tool';
import { CurvesTool } from '@/tools/curves-tool';
import { toast } from '@/components/ui/Toast';

vi.mock('@/lib/toolrail-spawn', () => ({ spawnToolWidget: vi.fn(() => true) }));
vi.mock('@/lib/palette-actions', () => ({ proposeFromPalette: vi.fn().mockResolvedValue(undefined) }));

function open() {
  act(() => { window.dispatchEvent(new CustomEvent('spawn-palette:open')); });
}

beforeEach(() => {
  CanvasToolRegistry.register(LightTool);
  CanvasToolRegistry.register(CurvesTool);
  useEditorStore.getState().resetWorkspace();
  useEditorStore.getState().clearSelection?.();
  useBackendState.getState().reset();
  useBackendState.setState({ sseStatus: 'open' });
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('CommandPalette open + gating', () => {
  it('toasts and stays closed when there is no image node', () => {
    const spy = vi.spyOn(toast, 'info');
    render(<CommandPalette />);
    open();
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/search tools/i)).toBeNull();
  });

  it('opens and lists adjustment tools when an image node exists', () => {
    const lid = 'l1';
    useEditorStore.getState().addImageNode([lid]);
    render(<CommandPalette />);
    open();
    expect(screen.getByPlaceholderText(/search tools/i)).toBeDefined();
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Curves')).toBeDefined();
  });

  it('filters the list as the user types', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/search tools/i), 'cur');
    expect(screen.getByText('Curves')).toBeDefined();
    expect(screen.queryByText('Light')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: FAIL — `Cannot find module './CommandPalette'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/CommandPalette.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { useEditor } from '@/components/EditorProvider';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { toast } from '@/components/ui/Toast';
import { spawnToolWidget } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';
import type { Scope } from '@/types/widget';
import {
  buildToolCommands,
  filterCommands,
  imageNodeLabel,
  resolveInitialTargetId,
  nextTargetId,
  type PaletteCommand,
} from '@/lib/command-palette';

export function CommandPalette() {
  const { registry } = useEditor();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const imageNodes = useEditorStore((s) => s.imageNodes);
  const layers = useEditorStore((s) => s.layers);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const setActiveImageNode = useEditorStore((s) => s.setActiveImageNode);

  const toolCommands = useMemo(() => buildToolCommands(registry.getAll()), [registry]);
  const filtered = useMemo(() => filterCommands(toolCommands, query), [toolCommands, query]);

  const aiCommand: PaletteCommand | null = query.trim()
    ? { id: 'ai', kind: 'ai', label: `“${query.trim()}” → ask AI`, description: 'Send as a prompt' }
    : null;
  const flat = useMemo<PaletteCommand[]>(
    () => (aiCommand ? [...filtered, aiCommand] : filtered),
    [filtered, aiCommand],
  );

  const nodeIds = useMemo(() => Object.keys(imageNodes), [imageNodes]);
  const targetNode = activeImageNodeId ? imageNodes[activeImageNodeId] : undefined;
  const targetLabel = targetNode ? imageNodeLabel(targetNode, layers) : '';

  // Open handler — gates on SSE + at least one image node.
  useEffect(() => {
    function onOpen() {
      const ids = Object.keys(useEditorStore.getState().imageNodes);
      if (useBackendState.getState().sseStatus !== 'open') return;
      if (ids.length === 0) {
        toast.info('Open an image first.');
        return;
      }
      const initial = resolveInitialTargetId(ids, useEditorStore.getState().activeImageNodeId);
      if (initial) setActiveImageNode(initial);
      setQuery('');
      setActiveIndex(0);
      setOpen(true);
    }
    window.addEventListener('spawn-palette:open', onOpen);
    return () => window.removeEventListener('spawn-palette:open', onOpen);
  }, [setActiveImageNode]);

  const cycleTarget = useCallback(() => {
    setActiveImageNode(nextTargetId(nodeIds, activeImageNodeId));
  }, [nodeIds, activeImageNodeId, setActiveImageNode]);

  const run = useCallback(
    (cmd: PaletteCommand | undefined) => {
      if (!cmd) return;
      if (cmd.kind === 'tool' && cmd.toolName) {
        spawnToolWidget(cmd.toolName);
      } else if (cmd.kind === 'ai') {
        const active = useEditorStore.getState().activeScope ?? { kind: 'global' as const };
        const scope: Scope = active.kind === 'mask'
          ? { kind: 'mask', mask_id: active.mask_id }
          : { kind: 'global' };
        void proposeFromPalette(query.trim(), scope);
      }
      setOpen(false);
    },
    [query],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleTarget();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if ((e.metaKey || e.ctrlKey) && aiCommand) run(aiCommand);
        else run(flat[activeIndex]);
      }
    },
    [flat, activeIndex, aiCommand, cycleTarget, run],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 bg-black/40 z-40"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              onKeyDown={onKeyDown}
              aria-describedby={undefined}
            >
              <motion.div
                className="fixed top-[18%] left-1/2 z-50 overlay w-[440px] p-0"
                initial={{ opacity: 0, x: '-50%', y: 4 }}
                animate={{ opacity: 1, x: '-50%', y: 0 }}
                exit={{ opacity: 0, x: '-50%', y: 4 }}
                transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                {/* Search row + target chip */}
                <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-separator">
                  <Search size={14} className="text-text-secondary" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                    placeholder="Search tools or ask AI…"
                    className="flex-1 bg-transparent outline-none text-xs text-text-primary placeholder:text-text-secondary"
                  />
                  {targetLabel && (
                    <button
                      type="button"
                      onClick={cycleTarget}
                      title="Change target (Tab)"
                      className="text-[10px] text-text-secondary bg-surface-secondary px-2 py-1 rounded hover:text-text-primary"
                    >
                      → {targetLabel}
                    </button>
                  )}
                </div>

                {/* Results */}
                <div className="py-1.5 max-h-[50vh] overflow-y-auto">
                  {filtered.length > 0 && (
                    <div className="text-[9px] uppercase tracking-wide text-text-secondary px-3.5 py-1">
                      Adjustments
                    </div>
                  )}
                  {filtered.map((cmd, i) => (
                    <CommandRow
                      key={cmd.id}
                      command={cmd}
                      active={i === activeIndex}
                      onSelect={() => run(cmd)}
                    />
                  ))}
                  {aiCommand && (
                    <>
                      <div className="text-[9px] uppercase tracking-wide text-text-secondary px-3.5 py-1 mt-1">
                        AI
                      </div>
                      <CommandRow
                        command={aiCommand}
                        active={activeIndex === filtered.length}
                        onSelect={() => run(aiCommand)}
                      />
                    </>
                  )}
                  {flat.length === 0 && (
                    <div className="px-3.5 py-3 text-xs text-text-secondary">No matching tools.</div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3.5 px-3.5 py-2 border-t border-separator text-[10px] text-text-secondary">
                  <span>↑↓ navigate</span><span>↵ run</span><span>⇥ target</span><span>esc close</span>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function CommandRow({
  command,
  active,
  onSelect,
}: {
  command: PaletteCommand;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = command.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors
        ${active ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'}`}
    >
      <span className="w-4 flex justify-center text-text-secondary">
        {Icon ? <Icon size={14} /> : '✨'}
      </span>
      <span className="text-xs text-text-primary">{command.label}</span>
      {command.description && (
        <span className="text-[10px] text-text-secondary truncate">{command.description}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: PASS (the three gating/listing/filter tests; execution asserted in Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
git commit -m "feat(palette): command palette overlay with search, sections, target chip"
```

---

## Task 4: CommandPalette — execution + keyboard (extend tests)

**Files:**
- Modify: `src/components/CommandPalette.test.tsx`
- (Implementation already present from Task 3 — this task verifies it via tests; only add code if a test fails.)

- [ ] **Step 1: Add failing execution tests**

Append to `src/components/CommandPalette.test.tsx`:

```tsx
import { spawnToolWidget } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';

describe('CommandPalette execution', () => {
  it('runs the highlighted tool with Enter and closes', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(screen.getByPlaceholderText(/search tools/i), 'light{Enter}');
    expect(spawnToolWidget).toHaveBeenCalledWith('light');
    expect(screen.queryByPlaceholderText(/search tools/i)).toBeNull();
  });

  it('clicking a tool row spawns it', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.click(screen.getByText('Curves'));
    expect(spawnToolWidget).toHaveBeenCalledWith('curves');
  });

  it('Cmd+Enter sends the query to the AI', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(input, 'make it warmer');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(proposeFromPalette).toHaveBeenCalledWith('make it warmer', expect.objectContaining({ kind: 'global' }));
  });
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: PASS. If the Cmd+Enter test fails because focus is on the input, ensure the `onKeyDown` handler on `Dialog.Content` receives the event (it bubbles from the input). If needed, move the `onKeyDown` onto the inner `<input>` as well — but verify the bubbling path first per superpowers:systematic-debugging.

- [ ] **Step 3: Commit**

```bash
git add src/components/CommandPalette.test.tsx
git commit -m "test(palette): cover tool spawn, row click, and Cmd+Enter AI path"
```

---

## Task 5: Wire palette into App, remove the toolrail

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/components/toolbar/Toolbar.tsx`

- [ ] **Step 1: Swap the import**

In `src/App.tsx`, replace line 7:

```tsx
import { Toolbar } from '@/components/toolbar/Toolbar';
```

with:

```tsx
import { CommandTrigger } from '@/components/ui/CommandTrigger';
import { CommandPalette } from '@/components/CommandPalette';
```

- [ ] **Step 2: Replace the toolrail render**

In `MainLayout` (around line 69), replace:

```tsx
      <Toolbar />
```

with:

```tsx
      <CommandTrigger />
```

- [ ] **Step 3: Mount the palette + update the ⌘K comment**

In `EditorContent`'s returned JSX, add `<CommandPalette />` right after `<KeyboardShortcuts />` (line 164):

```tsx
      <KeyboardShortcuts />
      <CommandPalette />
```

Update the comment at line 134 from:

```tsx
  // ⌘K focuses the inline AskAiInput via the 'spawn-palette:open' event.
  // Disabled when the backend SSE connection is not open.
```

to:

```tsx
  // ⌘K opens the CommandPalette via the 'spawn-palette:open' event.
  // Disabled when the backend SSE connection is not open.
```

(Leave the `onKey` handler body unchanged — it still dispatches `spawn-palette:open`; the palette performs the no-image gate.)

- [ ] **Step 4: Delete the toolrail file**

```bash
git rm src/components/toolbar/Toolbar.tsx
```

- [ ] **Step 5: Verify the build/tests**

Run: `npm run check`
Expected: PASS — `tsc -b` finds no dangling `Toolbar` references, eslint (incl. `no-nested-component`) clean, all vitest suites green.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(palette): mount CommandPalette + CommandTrigger, remove toolrail"
```

---

## Task 6: Remove AskAiInput (superseded by the palette AI row)

**Files:**
- Modify: `src/components/inspector/SuggestionsSection.tsx`
- Delete: `src/components/inspector/AskAiInput.tsx`

- [ ] **Step 1: Drop the import and render**

In `src/components/inspector/SuggestionsSection.tsx`, remove line 7:

```tsx
import { AskAiInput } from './AskAiInput';
```

and remove line 57:

```tsx
      <AskAiInput />
```

- [ ] **Step 2: Delete the file**

```bash
git rm src/components/inspector/AskAiInput.tsx
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS — no remaining references to `AskAiInput`; the `proposeFromPalette` helper (still used by the palette) is untouched.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `npm run dev`, open an image, press ⌘K → palette opens with the 6 tools + target chip; type `cur` → Curves filters in; Enter → a Curves widget spawns tethered to the target; type a phrase + Cmd+Enter → AI suggestion appears. Click the ＋ button → same palette. Confirm the old left icon rail is gone.

- [ ] **Step 5: Commit**

```bash
git add src/components/inspector/SuggestionsSection.tsx
git commit -m "refactor(palette): retire AskAiInput in favor of palette AI row"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Invocation (⌘K + ＋ trigger) → Tasks 2, 5. ✔
- Gates (SSE closed / no image) → Task 2 (trigger disabled) + Task 3 (open handler toast). ✔
- Search + sections (Adjustments / AI) → Task 3. ✔
- Named tools + descriptions (no rätsel-icons) → Task 1 `TOOL_DESCRIPTIONS` + Task 3 rows. ✔
- Target chip + Tab cycle + single-node auto-select → Task 1 (`resolveInitialTargetId`/`nextTargetId`), Task 3 (chip + `cycleTarget` + open handler). ✔
- Execution via existing origins (`tool_invoked` / `mcp_user_prompt`) → Task 3/4 reuse `spawnToolWidget` / `proposeFromPalette`, unchanged. ✔
- Toolrail removed → Task 5. ✔
- AskAiInput migrated → Task 6. ✔
- Out of scope (no new backend, no widget/inspector changes) → respected; no backend files touched. ✔

**Placeholder scan:** No TBD/TODO; every code step has full code. ✔

**Type consistency:** `PaletteCommand`, `buildToolCommands`, `filterCommands`, `imageNodeLabel`, `resolveInitialTargetId`, `nextTargetId`, `spawnToolWidget(name)`, `proposeFromPalette(text, scope)` used identically across tasks. `filters` tool has `processingId: 'filter'` — execution passes tool **name** (`'filters'`) to `spawnToolWidget`, which resolves the id internally, so the mismatch is handled. ✔

**Known caveat (flagged for the implementer):** Setting `activeImageNodeId` via `setActiveImageNode` may be re-synced by React Flow canvas selection if the user clicks the canvas while the palette is open. Acceptable for v1 (palette is modal/focused). If it proves flaky during the Task 6 smoke test, revisit using selection-slice instead.
