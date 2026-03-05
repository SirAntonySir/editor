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
- **Cropping**: react-advanced-cropper
- **Icons**: Lucide React (tree-shaken named imports only)

## Architecture Principles
- **Non-destructive editing by default** — adjustments stored as metadata, not pixel mutations
- **Pixel data lives outside Zustand** — CanvasRegistry (Map of layer IDs → OffscreenCanvas pairs)
- **Tool Registry pattern** — tools are self-contained ToolDefinition objects (Open/Closed Principle)
- **Command pattern** for destructive ops with region-based compressed snapshots
- **Web Workers** for all heavy computation (Comlink + worker pool)
- **Layer compositing** — each layer rendered through its own WebGL adjustment pipeline, then composited with 2D Canvas blend modes

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
    inspector/          #   Adjustment sliders, tool option panels
    panels/             #   Layers panel with drag reorder
    toolbar/            #   Main toolbar
    ui/                 #   shadcn/ui primitives
  tools/                # ToolDefinition objects (self-contained)
    select-tool.ts      #   Selection / move
    brush-tool.tsx      #   Freehand drawing (pressure-sensitive)
    text-tool.tsx       #   Editable, movable text layers (TextMeta)
    crop-tool.tsx       #   Crop with aspect ratio presets
    light-tool.tsx      #   Exposure, contrast, highlights, shadows
    color-tool.tsx      #   Saturation, vibrance
    kelvin-tool.tsx     #   White balance (temperature + tint)
    curves-tool.tsx     #   RGB curves
    levels-tool.tsx     #   Levels with live histogram
    filters-tool.tsx    #   LUT-based colour grading
  store/                # Zustand slices
    layer-slice.ts      #   Layers, adjustments, TextMeta, blend modes
    tool-slice.ts       #   Active tool, editor mode
    viewport-slice.ts   #   Zoom, pan, canvas dimensions
  shaders/              # GLSL shader sources (as TS template literals)
  lib/                  # Core utilities
    canvas-registry.ts  #   Pixel data store (source + working OffscreenCanvas)
    layer-compositor.ts #   Multi-layer compositing with blend modes
    pipeline-manager.ts #   WebGL render pipeline orchestration
    tool-registry.ts    #   Tool registration and lookup
    lut-registry.ts     #   LUT filter management
    lut-parser.ts       #   .cube LUT file parser
  types/                # Shared TypeScript interfaces
```
