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
| Cropping | Custom Fabric.js non-destructive crop (straighten, rotate, flip) |

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
    crop-tool.tsx       #   Crop mode entry
    light-tool.tsx      #   Exposure, contrast, highlights, shadows
    color-tool.tsx      #   Saturation, vibrance
    kelvin-tool.tsx     #   White balance (temperature + tint)
    curves-tool.tsx     #   RGB curves
    levels-tool.tsx     #   Levels with live histogram
    filters-tool.tsx    #   LUT-based colour grading
  store/                # Zustand slices
    layer-slice.ts      #   Layers, adjustments, text metadata, crop metadata
    tool-slice.ts       #   Active tool, editor mode
    viewport-slice.ts   #   Zoom, pan, canvas dimensions
  shaders/              # GLSL shader sources (as TS template literals)
  lib/                  # Core utilities
    canvas-registry.ts  #   Pixel data store (source + working + pre-crop original)
    crop-utils.ts       #   Crop math (inscribed rect, state save/restore)
    crop-rect.ts        #   Fabric.js crop rect, overlay strips, boundary clamping
    layer-compositor.ts #   Multi-layer compositing with blend modes
    pipeline-manager.ts #   WebGL render pipeline orchestration
    tool-registry.ts    #   Tool registration and lookup
    lut-registry.ts     #   LUT filter management
    lut-parser.ts       #   .cube LUT file parser
  types/                # Shared TypeScript interfaces
```

## Architecture

- **Non-destructive editing** — adjustments are stored as metadata on each layer, not as pixel mutations. The original pixels are always preserved. Crop is also non-destructive: the pre-crop original is stored alongside the cropped version, and re-entering crop mode shows the full image with the crop mask.
- **CanvasRegistry** — pixel data (OffscreenCanvas pairs: source + working + optional pre-crop original) lives outside Zustand to avoid serialisation overhead. Crop metadata (`CropMeta`) is stored on the layer.
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

## AI dev loop (Phase 1)

Two processes:

```bash
# Terminal 1 — backend (Python)
cd backend
python3.11 -m venv .venv    # or python3.12 — see backend/README.md for Python version requirement
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env  # fill in ANTHROPIC_API_KEY
uvicorn app.main:app --reload --port 8787
```

```bash
# Terminal 2 — frontend (Vite)
npm install
cp .env.example .env  # only needed if backend URL changes (defaults to 127.0.0.1:8787)
npm run dev
```

Or after setup:

```bash
npm run dev:backend  # backend (zsh/bash; macOS/Linux)
npm run dev          # frontend
```

Open the editor, load an image — you should see an "Analysing image…" indicator
turn to "Image context ready" within a few seconds. Press Cmd+K, type a goal
(e.g. "make it warmer"), and an AI panel appears in the inspector below the
standard tool panel.

## License

Private — all rights reserved.
