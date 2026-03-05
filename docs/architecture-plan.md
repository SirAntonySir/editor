# Architecture plan for a high-fidelity React photo editor

**A plug-and-play, extensible web photo editor demands a layered architecture: Fabric.js for canvas interaction, custom WebGL shaders for real-time filters, Zustand for state, and a Lexical-inspired tool registry that fully decouples tool logic from UI.** This plan synthesizes research across 11 library categories, open-source editor analysis, and plugin architecture patterns into a production-ready blueprint. The stack prioritizes non-destructive editing (most operations stored as metadata, not pixel mutations), which collapses undo/redo complexity and enables a fast, memory-efficient experience even on 4K+ images.

---

## Recommended tech stack with justifications

### Core rendering and image processing

| Layer | Library | Stars | Bundle | Why |
|---|---|---|---|---|
| **Canvas interaction** | **Fabric.js v7** | ~31K | 95.7 kB gzip | Only library combining a rich interactive object model (select, resize, rotate, text editing, grouping, serialization) with **WebGL-accelerated filters** and Canvas 2D fallback. TypeScript-native since v6. |
| **Filter pipeline** | **Custom WebGL shaders** | — | ~2 kB wrapper | Ping-pong framebuffer pipeline delivering **60 fps on 4K images**. Shader code borrowed from glfx.js and WebGLImageFilter as reference. Fabric's built-in filters handle simple cases; custom WebGL handles advanced curves, LUTs, and multi-pass chains. |
| **Heavy processing** | **Photon WASM** | ~3.3K | 371 kB gzip (wasm) | Rust-compiled, **4–10× faster than JS** for pixel processing. 96 functions (resize, channel ops, convolutions). Runs in Web Worker via Comlink for zero main-thread blocking. |
| **Cropping** | **react-advanced-cropper** | ~860 | Small | Stencil architecture allows **complete UI replacement** while retaining all interaction logic (zoom, rotate, aspect ratio, gestures). Framework-agnostic core. TypeScript native. Ideal for Apple HIG-styled crop overlays. |
| **HEIC decode** | heic2any / heic-to | — | ~2.7 MB (libheif wasm) | HEIC has zero native browser support. heic-to uses libheif 1.21.2 for decoding to JPEG/PNG. |
| **TIFF decode** | utif2 | — | Small | Photopea's own library. `UTIF.decode()` → `UTIF.toRGBA8()`. |
| **EXIF read/write** | exifr (read) + piexifjs (write) | — | ~4 kB / ~10 kB | exifr: fastest JS EXIF parser (0.5 ms avg). piexifjs: read AND write, enabling EXIF preservation on export. |

### UI component system

| Concern | Choice | Rationale |
|---|---|---|
| **Primitives** | **Radix UI** (~18.5K stars) | Headless, accessible, individually packaged. Popover, Slider, DropdownMenu, ContextMenu, Tooltip, ToggleGroup — all critical for editor UI. |
| **Component library** | **shadcn/ui** (~85K+ stars) | Copy-paste source ownership. Built on Radix + Tailwind. Full control for Apple HIG restyling without fighting an opinionated theme. |
| **Floating panels** | **Floating UI** (~32.5K stars) | 3 kB core. Virtual element anchoring (critical for canvas-attached toolbars at arbitrary `{x,y}`). Radix for standard popovers; Floating UI for cursor-following panels and canvas-anchored inspectors. |
| **Icons** | **Lucide React** v0.576+ (~21.4K stars) | Default shadcn icon set. **1–2 kB per icon**, fully tree-shakeable. 1,000+ icons including Crop, Layers, Sliders, Paintbrush, Pipette, Undo, Redo. Named imports only — never star-import. |
| **Styling** | **Tailwind CSS** + custom 8pt grid config | `tailwindcss-animate` for panel entrance/exit, custom Apple shadow/blur utilities, SF Pro system font stack. |
| **Animation** | **Framer Motion** (Motion) | Spring-based animations matching Apple HIG feel: stiffness 300–500, damping 25–35. `whileHover`, `whileTap` for micro-interactions. |

### State and data management

| Concern | Choice | Rationale |
|---|---|---|
| **Primary state** | **Zustand v5 + Immer middleware** (~57K stars, ~1–3 kB) | Slice pattern for modular stores. No Provider required — accessible from Workers, canvas loops, AI callbacks. Selective subscriptions prevent unnecessary re-renders. |
| **Undo/redo (metadata)** | **zundo** temporal middleware (765 stars) | Wraps Zustand store. `partialize` excludes pixel data; `limit: 50` caps history. Immer patches keep entries at ~100 bytes each. |
| **Undo/redo (pixels)** | **Custom PixelHistoryManager** | Command pattern for destructive ops. Captures compressed WebP region snapshots via `OffscreenCanvas.convertToBlob()`. Region-based, not full-canvas. |
| **Tool state machines** | **XState v5** (~27K stars) | Optional but recommended for complex tool modes (brush: idle→drawing→finishing; AI: idle→processing→reviewing→applying). Visualizable, testable. |
| **AI API layer** | **TanStack Query v5** (~48.6K stars) | Mutations for AI calls, built-in retry/backoff, polling via `refetchInterval`, AbortController for cancellation, optimistic updates. Zustand manages queue UI state. |

---

## Architecture overview

The system is organized into four distinct layers. Each layer communicates through well-defined interfaces, enabling any layer to be swapped independently.

```
┌──────────────────────────────────────────────────────┐
│                    UI LAYER                           │
│  shadcn/ui + Radix + Floating UI + Tailwind          │
│  ┌─────────┐  ┌──────────┐  ┌───────────────────┐   │
│  │ Toolbar  │  │ Inspector│  │ Canvas Overlays   │   │
│  │ (tools)  │  │ (options)│  │ (crop, brush, etc)│   │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘   │
│       │              │                 │              │
│  ┌────▼──────────────▼─────────────────▼──────────┐  │
│  │           TOOL REGISTRY LAYER                   │  │
│  │  ToolRegistry → ToolContext → EditorProvider     │  │
│  │  Each tool: lifecycle hooks, commands, UI slots  │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │            STATE LAYER                          │  │
│  │  Zustand (slices: layers, tools, selection, UI) │  │
│  │  + zundo (metadata history)                     │  │
│  │  + PixelHistoryManager (compressed snapshots)   │  │
│  │  + XState (tool FSMs)                           │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │         CANVAS + PROCESSING LAYER               │  │
│  │  Fabric.js (interaction) + WebGL (filters)      │  │
│  │  + Photon WASM (heavy ops, in Web Worker)       │  │
│  │  + AI Pipeline (TanStack Query + queue)         │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Pixel data lives outside Zustand entirely.** Each layer's raster content is stored in a `CanvasRegistry` — a Map of layer IDs to `OffscreenCanvas` instances. Zustand stores only metadata (layer order, opacity, blend mode, filter parameters, transforms). This prevents 48 MB+ `ImageData` buffers from polluting state snapshots and makes undo/redo nearly free for most operations.

---

## Plugin/tool extensibility pattern

The tool system draws from three proven architectures: **Lexical's React-native plugin model** (tools are composable React components), **tui.image-editor's Command pattern** (state mutations as reversible command objects), and **VS Code's Contribution Points** (tools declare which UI slots they occupy).

### The ToolDefinition interface

```typescript
interface ToolDefinition<TConfig = any> {
  name: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  category: 'select' | 'draw' | 'adjust' | 'filter' | 'ai' | 'transform';
  shortcut?: string;
  cursor?: string;
  defaultConfig?: TConfig;

  // UI SLOT DECLARATIONS — tool declares what UI it needs
  OptionsPanel?: React.ComponentType<ToolOptionsPanelProps<TConfig>>;
  CanvasOverlay?: React.ComponentType<CanvasOverlayProps>;
  Modal?: React.ComponentType<ToolModalProps>;
  ToolbarExtras?: React.ComponentType;

  // LIFECYCLE — pure tool logic, no UI
  onActivate?: (ctx: ToolContext) => void | (() => void);
  onDeactivate?: (ctx: ToolContext) => void;

  // CANVAS INTERACTION — decoupled from rendering
  onPointerDown?: (e: CanvasPointerEvent, ctx: ToolContext) => void;
  onPointerMove?: (e: CanvasPointerEvent, ctx: ToolContext) => void;
  onPointerUp?: (e: CanvasPointerEvent, ctx: ToolContext) => void;

  // COMMANDS — pure functions for state mutation
  commands?: Record<string, EditorCommand>;
}
```

**This is the key decoupling mechanism.** The `onPointerDown/Move/Up` handlers and `commands` contain all tool logic as pure functions receiving an injected `ToolContext`. The `OptionsPanel`, `CanvasOverlay`, and `Modal` are React components that can be replaced entirely — swap from an Apple HIG-styled sidebar to a floating popover without touching any tool logic. The tool registry auto-wires shortcuts, cursor changes, and lifecycle from the declaration.

### How a tool is registered and composed

```tsx
// Define a brightness tool
const BrightnessTool: ToolDefinition<{ value: number }> = {
  name: 'brightness',
  label: 'Brightness',
  icon: Sun,
  category: 'adjust',
  shortcut: 'B',
  defaultConfig: { value: 0 },
  OptionsPanel: BrightnessSliderPanel, // Swappable UI
  commands: {
    setBrightness: {
      execute: (state, { value }) => ({
        newState: { ...state, adjustments: { ...state.adjustments, brightness: value } },
        undoData: { prev: state.adjustments.brightness },
      }),
      undo: (state, { prev }) => ({
        ...state, adjustments: { ...state.adjustments, brightness: prev }
      }),
    },
  },
};

// Compose the editor (Lexical-style)
<PhotoEditor tools={[CropTool, BrightnessTool, AIRemoveBgTool, FiltersTool]}>
  <Toolbar />             {/* Reads tools from context, renders icons */}
  <InspectorPanel />      {/* Renders active tool's OptionsPanel */}
  <CanvasViewport />      {/* Renders canvas + active tool's CanvasOverlay */}
  <ActiveToolModal />     {/* Renders active tool's Modal if present */}
  <KeyboardShortcuts />   {/* Auto-registers shortcuts from all tools */}
  <HistoryPlugin />       {/* Undo/redo via Command pattern */}
</PhotoEditor>
```

Adding a new tool means creating a single `ToolDefinition` object and passing it to the `tools` array. No existing files need modification — the **Open/Closed Principle** is satisfied.

---

## AI async pipeline design

AI operations follow a lifecycle: **idle → queued → processing → streaming → complete/error**. The pipeline combines TanStack Query for API communication with Zustand for queue visibility in the UI.

### Dual-API strategy

**OpenAI** returns results synchronously (base64 in response) or via streaming partial images through the Responses API. **Replicate** creates a prediction object and requires polling, webhooks, or SSE streaming. The pipeline abstracts both behind a unified `AITaskProvider`:

```typescript
interface AITask {
  id: string;
  provider: 'openai' | 'replicate';
  type: 'remove-bg' | 'inpaint' | 'upscale' | 'generate';
  status: 'queued' | 'processing' | 'streaming' | 'complete' | 'error';
  progress: number;        // 0–100
  partialResult?: Blob;    // Progressive preview
  finalResult?: Blob;
  abortController: AbortController;
}
```

**TanStack Query handles the transport layer**: mutations for submitting tasks, `refetchInterval` for polling Replicate predictions (every 2 seconds, auto-stopping on completion), and built-in retry with exponential backoff for rate-limited responses (HTTP 429). The Zustand `aiQueueSlice` stores the task list for UI rendering — showing queue position, progress bars, and cancel buttons.

**Concurrency is capped at 2–3 simultaneous API calls** via a priority queue class. Tasks like background removal take priority over batch-style operations. Cancellation propagates through `AbortController` — aborting a task cancels the fetch, removes it from the queue, and triggers a `queryClient.invalidateQueries` to clean up stale data.

**Streaming partial results** use the OpenAI Responses API's `ImageEditPartialImageEvent`, which emits progressive base64 chunks. These are decoded and displayed on a preview layer in real-time, giving users visual feedback during generation. For Replicate's SSE-based streaming, an `EventSource` connection captures `output` events.

### Integration with undo/redo

AI results are applied as **new overlay layers** (non-destructive). The undo entry for an AI operation is simply "remove AI result layer + restore previous layer visibility." This costs near-zero memory — no pixel snapshots needed. If the user applies an AI result destructively (flatten into raster), the pixel snapshot system captures the affected region before merging.

---

## State management and undo/redo design

### Store architecture with Zustand slices

The store is composed of five domain slices, each with clear boundaries:

- **LayerSlice** — layer stack, ordering, visibility, opacity, blend mode, per-layer filter parameters, transform metadata. Pixel data is NOT here — only layer IDs referencing the `CanvasRegistry`.
- **ToolSlice** — active tool name, tool-specific configs (brush size, crop aspect ratio), cursor state.
- **SelectionSlice** — selected region geometry, selection mode, marching ants state.
- **ViewportSlice** — zoom level, pan offset, canvas dimensions, fit mode. Excluded from undo tracking.
- **AIQueueSlice** — active AI tasks, queue order, progress. Excluded from undo tracking.

```typescript
const useEditorStore = create<EditorStore>()(
  devtools(
    temporal(
      immer((...a) => ({
        ...createLayerSlice(...a),
        ...createToolSlice(...a),
        ...createSelectionSlice(...a),
        ...createViewportSlice(...a),
        ...createAIQueueSlice(...a),
      })),
      {
        limit: 50,
        partialize: (state) => ({
          layers: state.layers,
          activeLayerId: state.activeLayerId,
        }), // Only track metadata — excludes viewport, AI queue, tool state
      }
    )
  )
);
```

### Hybrid undo/redo strategy

**The critical architectural insight is that a photo editor has two fundamentally different state change categories**, and each needs a different undo strategy:

**Metadata changes** (layer reorder, opacity adjustment, filter parameter change, crop coordinates) account for **~90% of user operations** in a non-destructive editor. These are handled by zundo's temporal middleware using Immer patches — each undo entry stores ~100 bytes of JSON patches. Applying 50 undos takes <1 ms.

**Pixel changes** (brush strokes, clone stamp, destructive AI application) are handled by a separate `PixelHistoryManager` using the Command pattern. Before a destructive operation, it captures only the **affected bounding box region** as a compressed WebP blob via `OffscreenCanvas.convertToBlob()`. A 500×500 affected region compresses from ~1 MB raw to ~50–100 KB. Both systems share a unified timeline via entry IDs, so Ctrl+Z walks backwards through both metadata patches and pixel snapshots seamlessly.

**Memory budget**: With 50 history entries, worst case is ~150 MB of compressed pixel snapshots plus negligible metadata patches. Entries older than 10 steps can be offloaded to IndexedDB asynchronously (~50 ms read latency, acceptable for deep undo).

---

## The WebGL filter pipeline in detail

All non-destructive adjustments render through a **ping-pong framebuffer pipeline**. The source image is loaded as a WebGL texture. Each adjustment in the stack renders to alternating Framebuffer Objects (FBO-A → FBO-B → FBO-A), allowing arbitrary chaining with no intermediate readback to CPU.

**Simple adjustments combine into a single shader pass** for maximum efficiency. Brightness, contrast, saturation, hue rotation, temperature, and tint all run in one fragment shader — a single texture sample plus ~20 arithmetic instructions. This renders a 4K image in **2–5 ms** versus 100–300 ms with Canvas 2D `getImageData` loops.

**Curves and levels** use 1D LUT textures. The user manipulates control points on a cubic spline; the spline is evaluated into a 256-entry array, uploaded as a 256×1 texture, and sampled in the shader. Each channel (R, G, B, luminance) gets its own curve. LUT-based preset filters (Instagram/VSCO style) use 3D texture lookups against `.cube` files parsed into 64³ textures.

**The adjustment stack is a data structure, not a pixel mutation:**

```typescript
interface AdjustmentStack {
  adjustments: Array<{
    type: 'basic' | 'curves' | 'lut' | 'sharpen' | 'vignette';
    enabled: boolean;
    params: Record<string, number | Float32Array>;
  }>;
}
```

When any slider changes, the entire pipeline re-renders from the source texture. At 60 fps, this feels instant. For export, the pipeline renders at full resolution (not preview size) and calls `canvas.toBlob()`.

---

## UI/UX component system with Apple HIG principles

The visual system uses an **8-point spacing grid** throughout. All padding, margins, and sizes snap to multiples of 8px (with a 4px sub-grid for tight label spacing). The font stack uses `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`, which renders SF Pro on Apple devices and Segoe UI on Windows — both optimized for UI legibility.

### Floating glass panels

Panels use `backdrop-filter: blur(20px) saturate(180%)` with a semi-transparent background (`rgba(255, 255, 255, 0.72)` in light mode, `rgba(30, 30, 30, 0.72)` in dark mode). A thin **0.5px semi-transparent border** provides edge definition. Multi-layer shadows (`0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.05)`) create Apple's characteristic depth. Corner radius is **10–12px** for panels, 8px for buttons. The `backdrop-filter` should be limited to toolbar, inspector, and modal panels only — stacking multiple blurred elements degrades GPU performance.

### Component hierarchy

- **Toolbar** (top): Radix `ToggleGroup` styled as a segmented control. Icon-only buttons at 28–32px with Radix `Tooltip` (300 ms delay). Active tool highlighted with a subtle background fill and spring animation.
- **Inspector** (right sidebar): Active tool's `OptionsPanel` rendered here. Radix `Slider` for all numeric adjustments, `Popover` for color pickers, `DropdownMenu` for blend mode selection. Sections separated with `Separator` primitives.
- **Canvas-anchored panels**: Floating UI for context-sensitive toolbars that anchor to selections or cursor position. Virtual element support lets panels follow arbitrary `{x, y}` coordinates on the canvas.
- **Modals**: Radix `Dialog` for export settings, new document, filter gallery. Glass panel styling with Framer Motion spring entrance (scale 0.95→1, opacity 0→1, stiffness 400, damping 30).

### Animation tokens

All transitions use CSS `cubic-bezier(0.2, 0, 0, 1)` for standard interactions (150 ms) and spring physics via Framer Motion for physical properties. Panels enter with `scale(0.96) → scale(1)` over 250 ms. Hover states use `whileHover={{ scale: 1.02 }}` with stiffness 500. The `prefers-reduced-motion` media query disables all non-essential animation.

---

## File I/O and format support

| Format | Read | Write | Method |
|---|---|---|---|
| **JPEG** | Native | Native | `createImageBitmap()` / `canvas.toBlob('image/jpeg', quality)` |
| **PNG** | Native | Native | `canvas.toBlob('image/png')` |
| **WebP** | Native | Native | `canvas.toBlob('image/webp', quality)` |
| **TIFF** | utif2 | utif2 | `UTIF.decode()` → `UTIF.toRGBA8()` → Canvas |
| **HEIC** | heic-to | ✗ | libheif WASM decode → PNG/JPEG intermediate |

**File reading** uses `createImageBitmap(file)` exclusively — it decodes off the main thread, unlike `new Image()` which blocks. For large files (>10 MB), decoding runs in a Web Worker.

**Export** uses `canvas.toBlob()` (async, non-blocking) rather than `toDataURL()` (sync, blocks UI on large canvases). EXIF metadata is preserved on JPEG export by reading the original EXIF with exifr, then re-inserting it into the exported blob with piexifjs. The **File System Access API** (`showSaveFilePicker`) enables save-in-place on Chrome/Edge, with a fallback to download-link for Firefox/Safari.

---

## Performance architecture

**Web Workers via Comlink** handle all heavy computation. Comlink (12.5K stars, 1.1 kB) wraps Worker communication with ES6 Proxies — the worker exports a class, the main thread calls methods as if they were local async functions. A **worker pool** (sized to `navigator.hardwareConcurrency`, typically 4–8) processes concurrent operations.

**Transferable objects** enable zero-copy ArrayBuffer transfer between threads. When sending a 48 MB ImageData buffer to a worker, ownership transfers in O(1) instead of copying. The buffer becomes detached on the sender side.

**OffscreenCanvas** (Baseline 2023 — Chrome 69+, Firefox 105+, Safari 16.4+) enables canvas rendering entirely within a worker thread. Filter previews, histogram computation, and export rendering all run on OffscreenCanvas without touching the main thread. `requestAnimationFrame()` works inside workers, enabling smooth animation-independent-of-UI rendering loops.

**Photon WASM runs exclusively in workers.** WASM initialization (~50 ms) happens once at worker creation. All 96 Photon functions (resize, filter, channel manipulation) execute at near-native speed. Memory management is manual — `img.free()` must be called after every operation to prevent WASM heap growth.

---

## Phased implementation roadmap

### Phase 1: Foundation (weeks 1–3)
Set up the project scaffold: React + Vite + TypeScript + Tailwind. Implement the Zustand store with layer and viewport slices. Build the Fabric.js canvas wrapper component with basic image loading (`createImageBitmap`), pan, and zoom. Create the `ToolRegistry`, `EditorProvider` context, and `ToolDefinition` interface. Implement a minimal `SelectTool` (move/resize layers) and `CropTool` (integrating react-advanced-cropper) to validate the tool architecture. Wire zundo for metadata undo/redo. Build the Apple HIG Tailwind theme (spacing grid, font stack, color tokens, glass panel utility classes).

### Phase 2: Adjustment pipeline (weeks 4–6)
Build the custom WebGL shader pipeline with ping-pong framebuffers. Implement the combined brightness/contrast/saturation/hue shader as a single pass. Add curves (cubic spline → 1D LUT texture) and levels adjustments. Create `BrightnessTool`, `ContrastTool`, `CurvesTool` as `ToolDefinition` objects with `OptionsPanel` components using Radix Slider. Build the adjustment stack data model in Zustand and connect it to the shader pipeline. Validate 60 fps rendering on 4K test images.

### Phase 3: UI system (weeks 5–7, overlapping with Phase 2)
Build the toolbar with Radix ToggleGroup, inspector sidebar with tool-aware rendering, and floating panels with Floating UI. Implement Apple HIG glass panels, spring animations via Framer Motion, keyboard shortcut system, and Radix context menus. Build the layers panel with drag-to-reorder, visibility toggles, and opacity sliders.

### Phase 4: Advanced tools and processing (weeks 7–9)
Set up Comlink worker pool and Photon WASM integration. Build the `PixelHistoryManager` for destructive operation undo. Add LUT-based preset filters (parse `.cube` files, 3D texture lookup shader). Implement brush/paint tool with canvas interaction handlers and pixel history snapshots. Add text tool using Fabric.js's built-in text editing. Implement HEIC/TIFF import and EXIF-preserving JPEG export.

### Phase 5: AI integration (weeks 9–11)
Build the AI task pipeline: TanStack Query mutations, polling for Replicate, streaming for OpenAI. Implement `AIRemoveBackgroundTool`, `AIInpaintTool`, `AIUpscaleTool` as ToolDefinitions. Build the AI queue UI showing task status, progress, and cancellation. Add AI results as non-destructive overlay layers. Implement AbortController propagation for cancellation.

### Phase 6: Polish and optimization (weeks 11–13)
Move filter preview rendering to OffscreenCanvas in workers. Add histogram computation in a worker. Implement File System Access API save-in-place. Performance profiling and optimization — ensure sub-16 ms frame times during slider interaction. Implement `partialize`-based history compaction and IndexedDB offloading for deep undo. Add export dialog with format selection, quality slider, and resolution options. Accessibility audit using Radix's built-in ARIA support.

---

## Conclusion

The architecture's central bet is **non-destructive editing as the default mode**. By storing adjustments as metadata (filter parameters, transforms, layer properties) rather than pixel mutations, the system achieves three compounding benefits: undo/redo costs near-zero memory (Immer patches at ~100 bytes each), the WebGL pipeline re-renders the full adjustment stack at 60 fps from source, and AI results integrate cleanly as overlay layers. The tool registry pattern — inspired by Lexical's composable plugins and tui.image-editor's command separation — ensures that adding a new tool means writing a single `ToolDefinition` object with no modification to existing code. The riskiest technical bet is the custom WebGL shader pipeline, but reference implementations from glfx.js and WebGLImageFilter provide battle-tested GLSL code for every standard adjustment. Fabric.js v7 carries the heaviest bundle (95.7 kB gzip) but eliminates months of development for interactive canvas features — no other library offers both an object model and WebGL filters in one package.