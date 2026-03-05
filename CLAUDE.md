# Photo Editor — Claude Development Environment

## Project Overview
High-fidelity React photo editor with non-destructive editing, WebGL filter pipeline, Fabric.js canvas, and AI integration.

Full architecture plan: `docs/architecture-plan.md`

## Tech Stack
- **Framework**: React + Vite + TypeScript
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
- **Pixel data lives outside Zustand** — CanvasRegistry (Map of layer IDs → OffscreenCanvas)
- **Tool Registry pattern** — tools are self-contained ToolDefinition objects (Open/Closed Principle)
- **Command pattern** for destructive ops with region-based compressed snapshots
- **Web Workers** for all heavy computation (Comlink + worker pool)

## Code Conventions
- TypeScript strict mode
- Named imports for Lucide icons (never star-import)
- Zustand slice pattern for modular stores
- 8-point spacing grid for all UI
- Apple HIG design language (glass panels, spring animations, SF Pro font stack)
- `createImageBitmap()` for image loading (never `new Image()`)
- `canvas.toBlob()` for export (never `toDataURL()`)

## Phased Development Agents
Use the phase agents (`.claude/agents/`) to step through implementation:
1. `phase-1-foundation.md` — Project scaffold, store, canvas, tool registry, theme
2. `phase-2-adjustments.md` — WebGL pipeline, adjustment tools, shader system
3. `phase-3-ui.md` — Toolbar, inspector, floating panels, animations, layers panel
4. `phase-4-advanced-tools.md` — Workers, Photon WASM, brush, text, file I/O
5. `phase-5-ai.md` — AI pipeline, remove-bg/inpaint/upscale tools, queue UI
6. `phase-6-polish.md` — OffscreenCanvas, perf optimization, export, accessibility

Invoke an agent with: `/agent phase-1-foundation` (etc.)

## Key Files (planned structure)
```
src/
  components/         # React UI components
    toolbar/
    inspector/
    canvas/
    panels/
  tools/              # ToolDefinition objects
  store/              # Zustand slices
  shaders/            # GLSL shader sources
  workers/            # Web Worker modules
  ai/                 # AI pipeline + providers
  lib/                # Utilities, canvas registry, pixel history
  types/              # Shared TypeScript interfaces
```
