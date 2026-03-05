# Photo Editor

A high-fidelity, browser-based photo editor built with React, Fabric.js, and a custom WebGL shader pipeline. Features non-destructive editing, multi-layer compositing, and an extensible tool system.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite + TypeScript (strict) |
| Canvas | Fabric.js v7 |
| Filters | Custom WebGL shaders (ping-pong framebuffers) |
| State | Zustand v5 + Immer + zundo (undo/redo) |
| UI | shadcn/ui, Radix UI, Tailwind CSS, Framer Motion, Floating UI |
| Icons | Lucide React |
| Cropping | react-advanced-cropper |

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Type-check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/
  components/           # React UI
    canvas/             #   EditorCanvas, CropOverlay, adjustment pipeline
    inspector/          #   Adjustment sliders, tool options
    panels/             #   Layers panel
    toolbar/            #   Main toolbar
    ui/                 #   shadcn/ui primitives
  tools/                # Self-contained ToolDefinition objects
    select-tool.ts      #   Selection / move
    brush-tool.tsx      #   Freehand drawing (pressure-sensitive)
    text-tool.tsx       #   Editable, movable text layers
    crop-tool.tsx       #   Crop with aspect ratio presets
    light-tool.tsx      #   Exposure, contrast, highlights, shadows
    color-tool.tsx      #   Saturation, vibrance
    kelvin-tool.tsx     #   White balance (temperature + tint)
    curves-tool.tsx     #   RGB curves
    levels-tool.tsx     #   Levels with live histogram
    filters-tool.tsx    #   LUT-based colour grading
  store/                # Zustand slices
    layer-slice.ts      #   Layers, adjustments, text metadata
    tool-slice.ts       #   Active tool, editor mode
    viewport-slice.ts   #   Zoom, pan, canvas dimensions
  shaders/              # GLSL shader sources (as TS template literals)
  lib/                  # Core utilities
    canvas-registry.ts  #   Pixel data store (source + working canvases)
    layer-compositor.ts #   Multi-layer compositing with blend modes
    pipeline-manager.ts #   WebGL render pipeline orchestration
    tool-registry.ts    #   Tool registration and lookup
    lut-registry.ts     #   LUT filter management
    lut-parser.ts       #   .cube LUT file parser
  types/                # Shared TypeScript interfaces
```

## Architecture

- **Non-destructive editing** — adjustments are stored as metadata on each layer, not as pixel mutations. The original pixels are always preserved.
- **CanvasRegistry** — pixel data (OffscreenCanvas pairs: source + working) lives outside Zustand to avoid serialisation overhead.
- **Tool Registry** — tools are self-contained `ToolDefinition` objects registered at startup. Adding a tool requires no changes to existing code (Open/Closed Principle).
- **WebGL pipeline** — shaders are chained via ping-pong framebuffers. Each layer's adjustment stack is rendered independently, then composited with 2D Canvas blend modes.
- **Layer compositing** — layers are sorted by order, each rendered through its own adjustment pipeline, then drawn onto a shared output canvas with per-layer opacity and blend mode.

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, production-ready code |
| `dev` | Active development |
| `testing` | QA and integration testing |
| `staging` | Pre-production validation |

## License

Private — all rights reserved.
