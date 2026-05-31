# Command Palette — Tool-Opening Rework

**Date:** 2026-05-31
**Status:** Design approved, pending spec review
**Branch:** `feat/canvas-workspace`

## Problem

Tools are opened today via a fixed 6-button vertical toolrail on the left
(`src/components/toolbar/Toolbar.tsx`). Three pain points:

1. **Abstract icons** — Light / Color / Kelvin / Curves / Levels / Filters are
   icon-only, not discoverable. The user must learn what each glyph means.
2. **The bar feels dated and takes space** — a permanent vertical icon rail is a
   classic editor convention that clashes with the canvas-centric, AI-native
   character of this editor.
3. **Unpredictable spawn** — clicking a button pops a widget onto the canvas with
   no visible control over *which* image it attaches to or where it lands.

## Solution

Replace the left toolrail with a **Command Palette** — "the Raycast of the
editor." A single searchable surface where the 6 adjustment tools live as named,
fuzzy-searchable commands alongside the existing AI prompt. Keyboard-first,
with a discreet `＋` trigger for mouse users.

This is purely a **front-end input rework**. No new backend path, no new widget
origins. The palette reuses the existing `spawnToolWidget` and
`proposeFromPalette` logic — we only rewire how those are invoked.

## Behavior / UX

### Invocation

- **`⌘K`** (keyboard) or click the discreet **`＋` button** sitting bottom-left
  where the toolrail used to be.
- **Gates (unchanged from today):**
  - Backend SSE not open (`useBackendState.sseStatus !== 'open'`) → palette
    disabled.
  - No image node in the workspace → `＋`/`⌘K` shows a toast
    "Open an image first".

### Search & sections

- Typing fuzzy-filters across all commands.
- Empty query: **Recents** at top, then all tools.
- **Sections:**
  - **Adjustments** — the 6 tools (Light, Color, White Balance, Curves, Levels,
    Filters), each shown with **name + short description** (no longer icon-only).
  - **AI** — the typed query offered as a prompt to the AI.
  - Structure is extensible (later: Actions, layer commands, etc.).

### Target image (solves "unpredictable spawn")

- A **target chip "→ Foto.jpg"** in the search row shows which image node the
  widget will attach to.
- The target defaults to the **active image node** (`activeImageNodeId`).
- **`⇥` (Tab)** cycles the target through the workspace's image nodes (sets
  `activeImageNodeId`).
- **If only one image node exists, it is auto-selected** — no prompting, the chip
  just shows it.
- If no image node exists at all, the invocation gate (above) fires the toast
  instead of opening the palette.

### Execution

- **`↵` on a tool** → spawn the widget tethered to the target image node, exactly
  as today: `backendTools.propose_widget(..., origin: 'tool_invoked')` via the
  existing `spawnToolWidget` path. SSE `widget.created` → `tetherWorkspaceWidget`
  → `nextSpawnPositionFor` positions it. Unchanged.
- **`⌘↵` on the AI row** → send the query as a prompt:
  `proposeFromPalette(text, scope)` with `origin: 'mcp_user_prompt'`. Unchanged.
- **`esc`** closes. **`↑/↓`** navigate. Footer shows these hints + the target.

## Architecture / Components

### New: `CommandPalette` (scaffold tier, `src/components/`)

A floating overlay surface. Per the 3-tier component rules (CLAUDE.md), it is a
page scaffold that composes primitives — it does not inline-define sub-components.

- **Command source:** reads the 6 tools from the existing tool registry
  (`src/tools/*.tsx`, each exposing `processingId`, label, icon). The Adjustments
  section is **generated** from this registry so there is no duplicate list to
  maintain — adding a future tool makes it appear in the palette automatically.
- **List/Item/Input primitives:** live in `src/components/ui/`. Implementation
  detail (reuse an existing `cmdk`/Radix-based primitive vs. build one) is
  deferred to the implementation plan; the plan must first search `ui/` for a
  reusable search-list primitive before introducing a dependency.

### Reused, unchanged

- `spawnToolWidget` (`src/lib/toolrail-spawn.ts`) — tool execution + active-image
  gate. The palette calls it; the gate logic is shared.
- `proposeFromPalette` (`src/lib/palette-actions.ts`) — AI prompt execution.
- `workspace-tether.ts` / `nextSpawnPositionFor` — widget positioning. Untouched.
- Backend `propose_widget`, all three origins, SSE flow. Untouched.

### Target management

A thin selector over `workspace.imageNodes` + `activeImageNodeId`. The `⇥` cycle
sets `activeImageNodeId`; the auto-select-when-single rule is a derived default.

### Removed / migrated

- **Removed:** the 6-button toolrail in `src/components/toolbar/Toolbar.tsx`.
  (Verify nothing else depends on the `ToggleGroup` toolrail before deleting.)
- **Migrated:** `AskAiInput` (today's `⌘K` surface in the inspector,
  `src/components/inspector/AskAiInput.tsx`) is superseded by the palette's AI
  row. The existing `spawn-palette:open` custom event (dispatched from
  `App.tsx` on `⌘K`) is repointed to open the new `CommandPalette`.

## Data Flow

```
⌘K / ＋ click
   └─> open CommandPalette (gate: SSE open + ≥1 image node)
         ├─ target chip = activeImageNodeId (auto = the only node if one)
         ├─ ⇥ cycles target → sets activeImageNodeId
         ├─ ↵ on tool  ─> spawnToolWidget(toolId)  ─> propose_widget(origin:'tool_invoked')
         └─ ⌘↵ on AI    ─> proposeFromPalette(text) ─> propose_widget(origin:'mcp_user_prompt')
                              └─ (existing SSE widget.created → tether → position)
```

## Edge Cases

- **No image node:** gate fires toast, palette does not open.
- **One image node:** target auto-selected, `⇥` is a no-op (or cycles to itself).
- **Backend disconnected:** palette disabled (matches existing tool gating).
- **Active layer not on active node:** target resolution keeps the existing
  `spawnToolWidget` fallback (first layer of the target node).
- **Recents empty (fresh session):** Recents section is simply omitted.

## Out of Scope (YAGNI)

- No nested palette views / sub-commands beyond the flat sectioned list.
- No reordering, favoriting, or custom command authoring.
- No change to widget appearance, the inspector, or AI suggestion behavior.
- No new backend endpoints or widget origins.

## Testing

- **Unit:** target-selection selector (active node, single-node auto-select,
  cycle wraps), command-list generation from the tool registry.
- **Interaction:** `⌘K` opens; typing filters; `↵` on a tool spawns a
  `tool_invoked` widget on the target; `⌘↵` sends an AI prompt; `esc` closes;
  gate toasts when no image / SSE closed.
- **Regression:** removing the toolrail does not break existing widget spawn,
  tethering, or positioning (same code paths).
