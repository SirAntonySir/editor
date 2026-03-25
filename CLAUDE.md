# Photo Editor — Claude Development Environment

## Project Overview
High-fidelity React photo editor with non-destructive editing, WebGL filter pipeline, Fabric.js canvas, and multi-layer compositing.

Full architecture plan: `docs/architecture-plan.md`

## Tech Stack
- **Framework**: React 19 + Vite + TypeScript (strict)
- **Canvas**: Fabric.js v7
- **Filters**: Custom WebGL shaders (ping-pong framebuffers)
- **Heavy processing**: Photon WASM (via Comlink Web Workers)
- **State**: Zustand v5 + Immer + zundo (undo/redo)
- **UI**: shadcn/ui + Radix UI + Tailwind CSS + Framer Motion + Floating UI
- **AI**: TanStack Query v5 (OpenAI + Replicate providers)
- **Cropping**: Custom Fabric.js non-destructive crop (crop rect, dark overlay, grid, straighten, 90° rotation, flip)
- **Icons**: Lucide React (tree-shaken named imports only)

## Architecture Principles
- **Non-destructive editing by default** — adjustments stored as metadata, not pixel mutations; crop is also non-destructive (original pixels preserved, crop params in `CropMeta`)
- **Pixel data lives outside Zustand** — CanvasRegistry (Map of layer IDs → OffscreenCanvas pairs + pre-crop originals)
- **Dual Registry pattern**:
  - **ToolRegistry** — canvas interaction tools (select, move, brush, crop) as ToolDefinition objects
  - **ProcessingRegistry** — processing features (light, color, curves, filters, AI, segmentation) as ProcessingDefinition objects. One registration makes a feature appear in inspector, graph nodes, and properties panel automatically.
  - Tools link to processing via `processingId` — the ToolDefinition handles toolbar/shortcuts, the ProcessingDefinition handles panels/nodes/params.
- **Extensible types** — `LayerType`, `Adjustment.type`, and graph node types are all `string` (not unions), so new processing/layer types can be registered without modifying core types
- **Command pattern** for destructive ops with region-based compressed snapshots
- **Web Workers** for all heavy computation (Comlink + worker pool)
- **Layer compositing** — each layer rendered through its own WebGL adjustment pipeline, then composited with 2D Canvas blend modes
- **Store separation** — EditorStore (layers, viewport, tools, document) + GraphStore (graph positions, viewport, layout) as separate Zustand stores
- **Document facade** (`editorDocument`) — single coordinator for store, pixel data, history, transactions, and serialization

## Code Conventions
- TypeScript strict mode
- Named imports for Lucide icons (never star-import)
- Zustand slice pattern for modular stores
- 8-point spacing grid for all UI
- Apple HIG design language (glass panels, spring animations, SF Pro font stack)
- `createImageBitmap()` for image loading (never `new Image()`)
- `canvas.toBlob()` for export (never `toDataURL()`)

## Branch Strategy
| Branch | Purpose |
|---|---|
| `main` | Stable, production-ready code |
| `dev` | Active development (default working branch) |
| `testing` | QA and integration testing |
| `staging` | Pre-production validation |

Always develop on `dev`. Merge flow: `dev` → `testing` → `staging` → `main`.

## Phased Development Agents
Use the phase agents (`.claude/agents/`) to step through implementation:
1. `phase-1-foundation.md` — Project scaffold, store, canvas, tool registry, theme
2. `phase-2-adjustments.md` — WebGL pipeline, adjustment tools, shader system
3. `phase-3-ui.md` — Toolbar, inspector, floating panels, animations, layers panel
4. `phase-4-advanced-tools.md` — Workers, Photon WASM, brush, text, file I/O
5. `phase-5-ai.md` — AI pipeline, remove-bg/inpaint/upscale tools, queue UI
6. `phase-6-polish.md` — OffscreenCanvas, perf optimization, export, accessibility

Invoke an agent with: `/agent phase-1-foundation` (etc.)

## Project Structure
```
src/
  components/           # React UI
    canvas/             #   EditorCanvas, CropOverlay, adjustment pipeline hook
    graph/              #   GraphEditor (React Flow), node components, properties panel
    inspector/          #   InspectorPanel (renders ProcessingDefinition.Panel or ToolDefinition.OptionsPanel)
    panels/             #   Layers panel with drag reorder
    toolbar/            #   Main toolbar, MenuBar
    ui/                 #   shadcn/ui primitives
  processing/           # ProcessingDefinition registrations (one file per processing type)
    light.tsx           #   Exposure, contrast, highlights, shadows (adjustmentType: 'basic')
    color.tsx           #   Saturation, vibrance, hue (adjustmentType: 'basic')
    kelvin.tsx          #   White balance (adjustmentType: 'kelvin')
    curves.tsx          #   RGB curves (adjustmentType: 'curves')
    levels.tsx          #   Levels with live histogram (adjustmentType: 'levels')
    filters.tsx         #   LUT-based colour grading (adjustmentType: 'lut')
    index.ts            #   registerAllProcessing() entry point
  tools/                # ToolDefinition objects (canvas interaction + processingId link)
    select-tool.ts      #   Selection / move
    brush-tool.tsx      #   Freehand drawing (pressure-sensitive)
    text-tool.tsx       #   Editable, movable text layers (TextMeta)
    crop-tool.tsx       #   Crop mode entry (sets editor mode)
    light-tool.tsx      #   Toolbar entry → processingId: 'light'
    color-tool.tsx      #   Toolbar entry → processingId: 'color'
    kelvin-tool.tsx     #   Toolbar entry → processingId: 'kelvin'
    curves-tool.tsx     #   Toolbar entry → processingId: 'curves' (+ CurvesPanel component)
    levels-tool.tsx     #   Toolbar entry → processingId: 'levels'
    filters-tool.tsx    #   Toolbar entry → processingId: 'filter' (+ FiltersPanel component)
  store/                # Zustand slices
    layer-slice.ts      #   Layers, adjustments, TextMeta, CropMeta, blend modes
    tool-slice.ts       #   Active tool, editor mode
    viewport-slice.ts   #   Zoom, pan, canvas dimensions
    graph-store.ts      #   Standalone graph state (positions, viewport, layout, selection)
  core/                 # Core logic
    document.ts         #   Document facade (store, pixel data, history, serialization)
    derived-graph.ts    #   Builds ProcessingGraph from layers via ProcessingRegistry
    layer-lifecycle.ts  #   Auto-cleans pixel data when layers are removed
  shaders/              # GLSL shader sources (as TS template literals)
  hooks/                # Extracted React hooks
    useCanvasZoom.ts    #   Zoom/fit controls
    useImageTransform.ts#   Rotate/flip operations
    useFileIO.ts        #   Open/save/export file I/O
  lib/                  # Core utilities
    processing-registry.ts  # ProcessingRegistry singleton
    tool-registry.ts        # ToolRegistry singleton
    use-processing-param.ts # Unified param hook (works in inspector + graph + nodes)
    use-adjustment.ts       # Legacy param hook (active layer + type lookup)
    use-graph-adjustment.ts # Legacy param hook (by adjustment ID)
    canvas-registry.ts      # Pixel data store (source + working + original OffscreenCanvas)
    param-ranges.ts         # Delegates to ProcessingRegistry for param ranges
    pipeline-manager.ts     # WebGL render pipeline orchestration
    layer-compositor.ts     # Multi-layer compositing with blend modes
    lut-registry.ts         # LUT filter management
    lut-parser.ts           # .cube LUT file parser
    crop-utils.ts           # Crop math (inscribed rect, state save/restore)
    crop-rect.ts            # Fabric.js crop rect, overlay strips, boundary clamping
  types/                # Shared TypeScript interfaces
    processing.ts       #   ProcessingDefinition, ProcessingPanelProps, ParamDefinition
    tool.ts             #   ToolDefinition, ToolContext, EditorCommand
    graph.ts            #   ProcessingNode, ProcessingEdge, ProcessingGraph
```
