# Photo Editor — Claude Development Environment

## Project Overview
High-fidelity React photo editor with non-destructive editing, WebGL filter pipeline, Fabric.js canvas, and multi-layer compositing.

Full architecture plan: `docs/architecture-plan.md`

## Tech Stack
- **Framework**: React 19 + Vite + TypeScript (strict)
- **Canvas**: Fabric.js v7
- **Filters**: Custom WebGL shaders (ping-pong framebuffers)
- **Heavy processing**: Photon WASM (via Comlink Web Workers)
- **State**: Zustand v5 + Immer (linear undo stack; no zundo)
- **UI**: shadcn/ui + Radix UI + Tailwind CSS + Framer Motion + Floating UI
- **AI**: Backend MCP server (SSE stream) + TanStack Query v5 for status
- **Icons**: Lucide React (tree-shaken named imports only)

## Architecture Principles
- **Non-destructive editing** — adjustment data lives in the backend `SessionStateSnapshot` (`operation_graph.nodes`), filtered by `layer_id` at render time. Frontend never owns adjustment state.
- **Pixel data lives outside Zustand** — CanvasRegistry (Map of layer IDs → OffscreenCanvas pairs)
- **Triple Registry pattern**:
  - **CanvasToolRegistry** — left-rail canvas tools (select, move) as ToolDefinition objects
  - **LlmToolRegistry** — LLM-facing tool manifests for the backend MCP server
  - **ProcessingRegistry** — processing features (light, color, curves, filters) as ProcessingDefinition objects. One registration makes a feature appear in the inspector panel and WebGL pipeline.
- **Extensible types** — `LayerType` and processing node types are all `string` (not unions), so new processing/layer types can be registered without modifying core types
- **Web Workers** for all heavy computation (Comlink + worker pool)
- **Layer compositing** — each layer rendered through its own WebGL adjustment pipeline, then composited with 2D Canvas blend modes. Pipeline reads from `snapshot.operation_graph.nodes` filtered by `layer_id === activeLayerId`.
- **Single EditorStore** composed of slices: layer, viewport, tool, document, segmentation (encoder state), selection. Plus a separate **BackendState** store for snapshot + SSE connection status.
- **Document facade** (`editorDocument`) — coordinates: store init, image open, undo/redo (linear stack), pixel data registry.
- **Three spawn paths, one backend call**: Cmd+K palette (`origin: 'mcp_user_prompt'`), backend autonomous analyze (`origin: 'mcp_autonomous'`), toolrail buttons (`origin: 'tool_invoked'`, skips LLM, ships defaults from `TOOL_DEFAULTS`). All three call `backendTools.propose_widget`.

## Code Conventions
- TypeScript strict mode
- Named imports for Lucide icons (never star-import)
- Zustand slice pattern for modular stores
- 8-point spacing grid for all UI
- Apple HIG design language (glass panels, spring animations, SF Pro font stack)
- `createImageBitmap()` for image loading (never `new Image()`)
- `canvas.toBlob()` for export (never `toDataURL()`)

## Component Architecture (strict)
The frontend follows a 3-tier hierarchy. **Reuse before invent.** Before writing JSX, search the existing tiers for a fit.

1. **Primitives** — `src/components/ui/` (plus `panels/GlassPanel.tsx`). Atomic, presentational, no app state. Wrap Radix or expose CSS tokens. Examples: `GlassPanel`, `Kbd`, `Empty`.
2. **Level-2 (topic folders)** — `canvas/`, `inspector/`, `panels/`, `toolbar/`. Compose primitives + read stores. Each folder owns its domain. (`graph/` has been removed — no graph mode.)
3. **Page scaffolds** — root of `src/components/` (`EditorDialog`, `PreferencesPage`, `EditorProvider`, `KeyboardShortcuts`, etc.). Wire level-2 pieces into surfaces.

**Hard rules:**
- **No inline-defined components.** Never declare a functional component inside another component body. Hoist to module scope or a sibling file. Render callbacks that don't represent a reusable unit are fine.
- **Reuse before invent.** Search `ui/` and the relevant topic folder first. If you're tempted to copy-paste JSX, extract a primitive instead.
- **Cross-domain primitives** (used by ≥2 topic folders) belong in `ui/`. Topic-local sub-components stay in their topic folder.
- **Style only via design tokens** in `src/index.css` (color, radius, shadow, motion vars). No hardcoded hex or px for design values.
- **Visual register**: see `design.md` at project root — it is authoritative for tokens, motion, and the glass-panel aesthetic.
- **Widget-driven panels**: `ProcessingDefinition.Panel` renders for each widget returned by the backend snapshot, not for static layer state. There is no "active tool drives panel" model.
- **Toolrail is 6 buttons** (Light / Color / Kelvin / Curves / Levels / Filters). All disabled when `useBackendState.sseStatus !== 'open'`.

**Enforcement:** `npm run check` (runs `tsc -b` + `eslint .` + the `no-nested-component` custom rule). Lint must pass before any commit; the rule is wired through pre-commit.

## Branch Strategy
| Branch | Purpose |
|---|---|
| `main` | Stable, production-ready code |
| `dev` | Active development (default working branch) |
| `testing` | QA and integration testing |
| `staging` | Pre-production validation |

Always develop on `dev`. Merge flow: `dev` → `testing` → `staging` → `main`.

## Phased Development Agents

> **Note:** The canvas-centric UI + Engine SSoT Reset (completed on `feat/canvas-centric-ui`) supersedes the phase 1–6 plan below. These agents describe the original architecture and are retained for historical reference only. Do not use them to guide new work.

1. `phase-1-foundation.md` — Project scaffold, store, canvas, tool registry, theme
2. `phase-2-adjustments.md` — WebGL pipeline, adjustment tools, shader system
3. `phase-3-ui.md` — Toolbar, inspector, floating panels, animations, layers panel
4. `phase-4-advanced-tools.md` — Workers, Photon WASM, brush, text, file I/O
5. `phase-5-ai.md` — AI pipeline, remove-bg/inpaint/upscale tools, queue UI
6. `phase-6-polish.md` — OffscreenCanvas, perf optimization, export, accessibility

## Project Structure
```
src/
  components/           # React UI
    canvas/             #   EditorCanvas, adjustment pipeline hook
    inspector/          #   InspectorPanel (renders ProcessingDefinition.Panel per widget)
    panels/             #   Layers panel with drag reorder
    toolbar/            #   Main toolbar (6-button toolrail), MenuBar
    ui/                 #   shadcn/ui primitives
  processing/           # ProcessingDefinition registrations (one file per processing type)
    light.tsx           #   Exposure, contrast, highlights, shadows (adjustmentType: 'basic')
    color.tsx           #   Saturation, vibrance, hue (adjustmentType: 'basic')
    kelvin.tsx          #   White balance (adjustmentType: 'kelvin')
    curves.tsx          #   RGB curves (adjustmentType: 'curves')
    levels.tsx          #   Levels with live histogram (adjustmentType: 'levels')
    filters.tsx         #   LUT-based colour grading (adjustmentType: 'lut')
    index.ts            #   registerAllProcessing() entry point
  tools/                # CanvasToolDefinition objects (left-rail canvas tools only)
    select-tool.ts      #   Selection / move
    light-tool.tsx      #   Toolrail entry → calls backendTools.propose_widget('light')
    color-tool.tsx      #   Toolrail entry → calls backendTools.propose_widget('color')
    kelvin-tool.tsx     #   Toolrail entry → calls backendTools.propose_widget('kelvin')
    curves-tool.tsx     #   Toolrail entry → calls backendTools.propose_widget('curves')
    levels-tool.tsx     #   Toolrail entry → calls backendTools.propose_widget('levels')
    filters-tool.tsx    #   Toolrail entry → calls backendTools.propose_widget('filters')
  store/                # Zustand slices
    layer-slice.ts      #   Layer metadata (id/name/order/visibility/blend/opacity/parentLayerId/layerMask)
    tool-slice.ts       #   Active tool, editor mode
    viewport-slice.ts   #   Zoom, pan, canvas dimensions
    selection-slice.ts  #   Unified selection state (activeScope, hoveredScope, focusedWidgetId, pendingBind, cycleStack)
  core/                 # Core logic
    document.ts         #   Document facade (store init, image open, linear undo/redo, pixel data registry)
    layer-lifecycle.ts  #   Auto-cleans pixel data when layers are removed
  shaders/              # GLSL shader sources (as TS template literals)
  hooks/                # Extracted React hooks
    useCanvasZoom.ts    #   Zoom/fit controls
    useImageTransform.ts#   Rotate/flip operations
    useFileIO.ts        #   Open/save/export file I/O
    useLayerWidgets.ts  #   Read snapshot filtered by layer_id for active layer
  lib/                  # Core utilities
    processing-registry.ts      # ProcessingRegistry singleton
    canvas-tool-registry.ts     # CanvasToolRegistry singleton (left-rail canvas tools)
    tool-manifest/
      llm-tool-registry.ts      # LlmToolRegistry — LLM-facing tool manifests for backend MCP server
    use-processing-param.ts     # Unified param hook (reads from snapshot widget node)
    canvas-registry.ts          # Pixel data store (source + working OffscreenCanvas per layer)
    param-ranges.ts             # Delegates to ProcessingRegistry for param ranges
    pipeline-manager.ts         # WebGL render pipeline orchestration
    layer-compositor.ts         # Multi-layer compositing with blend modes
    lut-registry.ts             # LUT filter management
    lut-parser.ts               # .cube LUT file parser
  types/                # Shared TypeScript interfaces
    processing.ts       #   ProcessingDefinition, ProcessingPanelProps, ParamDefinition
    tool.ts             #   ToolDefinition, ToolContext, EditorCommand
    adjustment.ts       #   Adjustment, BlendMode, AiSource types
```

## Engine SSoT Doctrine

Anything that affects pixels lives in the backend `SessionStateSnapshot`.
The frontend reads it, displays it, and calls backend tools to mutate it.

| Owner | Responsibility |
|---|---|
| Backend `SessionStateSnapshot` | widgets, operation_graph, masks_index, image_context, adjustment data per layer |
| Frontend `useEditorStore` | layer metadata (id/name/order/visibility/blend/opacity/parentLayerId/layerMask), viewport, document meta, simple linear undo, selection state (activeScope, hoveredScope, focusedWidgetId, pendingBind, cycleStack), UI-only state |
| Frontend `pixelStore` / `CanvasRegistry` | Raw source bitmaps per layer |

Three spawn paths → one backend call (`backendTools.propose_widget`):
- Cmd+K palette → `origin: 'mcp_user_prompt'`
- Backend autonomous analyze → `origin: 'mcp_autonomous'`
- Toolrail buttons (Light/Color/Kelvin/Curves/Levels/Filters) → `origin: 'tool_invoked'` (skips LLM, ships defaults from backend `TOOL_DEFAULTS`)

When the backend is disconnected (`useBackendState.sseStatus !== 'open'`): all tools disabled, Cmd+K disabled, last-rendered canvas visible.
