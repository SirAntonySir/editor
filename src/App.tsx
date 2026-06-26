import { useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ReactFlowProvider } from '@xyflow/react';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { CanvasWorkspace } from '@/components/workspace/CanvasWorkspace';
import { CanvasDropZone } from '@/components/workspace/CanvasDropZone';

import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { FloatingDock } from '@/components/ui/FloatingDock';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { CommandPalette } from '@/components/CommandPalette';
import { PreferencesDialog } from '@/components/PreferencesDialog';
import { MenuBar } from '@/components/toolbar/MenuBar';
import { RightSidebar } from '@/components/panels/RightSidebar';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { registerAllProcessing } from '@/processing';
import { registerAllToolManifests } from '@/lib/tool-manifest';
import { useEditorStore } from '@/store';
import { usePreferencesStore, applyPreferences } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { openImageFromPicker } from '@/lib/open-file';
import { initLayerLifecycle } from '@/core/layer-lifecycle';
import { initEditorStatePersistence } from '@/core/editor-state-persistence';
import { CurvesTool } from '@/tools/curves-tool';
import { LevelsTool } from '@/tools/levels-tool';
import { HslTool } from '@/tools/hsl-tool';
import { TimeOfDayTool } from '@/tools/time-of-day-tool';
import { Kbd } from '@/components/ui/kbd';

// Register processing definitions (must happen before tool registration and nodeTypes init)
registerAllProcessing();

// Register LLM-facing tool manifests (Plan 2)
registerAllToolManifests();

// Register tools (lean canvas-centric set — adjustment widget tools).
// Registry-driven ops are auto-registered as ToolDefinitions derived from
// their ProcessingDefinition. Bespoke tools (curves, hsl, levels, filters,
// time-of-day) are registered explicitly.
for (const def of ProcessingRegistry.getAll()) {
  if (!CanvasToolRegistry.has(def.id)) {
    CanvasToolRegistry.register({
      name: def.id,
      label: def.label,
      icon: def.icon,
      category: def.category as 'adjust' | 'filter' | 'ai' | 'transform' | 'select' | 'draw',
      processingId: def.id,
      onActivate: () => {},
    });
  }
}
CanvasToolRegistry.register(HslTool);
CanvasToolRegistry.register(CurvesTool);
CanvasToolRegistry.register(LevelsTool);
CanvasToolRegistry.register(TimeOfDayTool);

/** Main canvas area */
function MainLayout({
  layers,
  toolDef,
  toolContext,
  handleFileOpen,
}: {
  layers: unknown[];
  toolDef: ReturnType<ReturnType<typeof useEditor>['getActiveTool']>;
  toolContext: ReturnType<typeof useEditor>['toolContext'];
  handleFileOpen: () => void;
}) {
  return (
    <div className="relative flex-1 min-h-0 flex flex-row">
      {/* Canvas column — drop target for images dragged in from the OS. */}
      <CanvasDropZone className="relative flex-1 min-w-0 min-h-0">
        <div className="absolute inset-0">
          <CanvasContextMenu>
            <div className="absolute inset-0">
              <CanvasWorkspace />
            </div>
          </CanvasContextMenu>
        </div>

        {/* Tool canvas overlay */}
        {toolDef?.CanvasOverlay && <toolDef.CanvasOverlay ctx={toolContext} />}

        {/* Empty state. Flat composition over the dotted canvas — no
            card surface, no shadow. The framed icon + Kbd-augmented CTA
            match the editor's Vercel/Radix register (see design.md).
            Drag a photo onto the canvas (CanvasDropZone) or use the CTA. */}
        <AnimatePresence>
          {layers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="pointer-events-auto flex flex-col items-center gap-5 p-8 max-w-[340px] text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="text-[15px] font-medium tracking-tight text-text-primary">
                    Open an image to start
                  </div>
                  <div className="text-[12px] text-text-secondary leading-snug">
                    Drag a photo onto the canvas, or pick one from your files.
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleFileOpen}
                    className="inline-flex items-center bg-text-primary text-surface px-3.5 py-1.5 rounded-[var(--radius-button)] text-[12px] font-medium hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Open image
                  </button>
                  <Kbd keys="mod+O" className="ml-0" />
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>

      </CanvasDropZone>

      <RightSidebar />
    </div>
  );
}

function EditorContent() {
  const { toolContext, getActiveTool } = useEditor();
  const layers = useEditorStore((s) => s.layers);
  const toolDef = getActiveTool();

  // macOS draws the `hiddenInset` traffic lights in a 28px-tall title-bar
  // region with the lights vertically centred. Match that height so the
  // menu text (vertically centred in the bar) lines up with the lights.
  // Windows/Linux keep 24px to match the titleBarOverlay height in main.cjs.
  const isMac = typeof window !== 'undefined' && window.electron?.platform === 'darwin';
  const barHeight = isMac ? 28 : 24;

  // ⌘K toggles the CommandPalette — opens when closed (gated on SSE) and
  // closes when already open. ESC still closes via Dialog.Root's built-in
  // handler. We track open state from the palette's broadcast events to
  // keep both paths in sync.
  useEffect(() => {
    let paletteOpen = false;
    const onOpened = () => { paletteOpen = true; };
    const onClosed = () => { paletteOpen = false; };
    window.addEventListener('palette:opened', onOpened);
    window.addEventListener('palette:closed', onClosed);

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen) {
          window.dispatchEvent(new CustomEvent('palette:close-request'));
          return;
        }
        // Cmd+K opens the palette regardless of session state. File actions
        // (Open…, Add image…) are useful in the empty-canvas state; the AI
        // path stays gated inside the palette by sessionId / hasLayers so a
        // pre-session palette is harmless.
        window.dispatchEvent(new CustomEvent('spawn-palette:open'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('palette:opened', onOpened);
      window.removeEventListener('palette:closed', onClosed);
    };
  }, []);

  // Empty-state uploader. Routes through the shared picker so RAW files are
  // selectable (explicit-extension accept) and developed to JPEG before open.
  const handleFileOpen = useCallback(() => {
    openImageFromPicker();
  }, []);

  return (
    <div className="relative flex flex-col h-full">
      <KeyboardShortcuts />
      <CommandPalette />
      <PreferencesDialog />

      {/* Menu bar — fixed at top. Height tracks the OS title-bar region so the
          menu text vertically centres on the macOS traffic lights. */}
      <div
        className="relative z-30 flex-none flex items-center px-1 bg-surface border-b border-separator"
        style={{ height: barHeight }}
      >
        <MenuBar />
      </div>

      {/* Main canvas area */}
      <MainLayout
        layers={layers}
        toolDef={toolDef}
        toolContext={toolContext}
        handleFileOpen={handleFileOpen}
      />

      {/* Floating dock: suggestion chips · backend status · cmd+K · ambient
          caption. One canvas-aligned stack at bottom-center. */}
      <FloatingDock />
    </div>
  );
}

// Apply persisted preferences on initial load AND re-apply whenever any of
// the three live-styled keys change. The old PreferencesPage modal owned a
// useEffect that did the second half; once it was deleted, palette commands
// like "Theme: Dark" stopped updating the DOM until a reload. Subscribing
// here keeps theme/accent/radius live regardless of who flipped them, and a
// matchMedia listener handles OS-level dark-mode flips when themeMode is
// 'system'.
applyPreferences(usePreferencesStore.getState());
if (typeof window !== 'undefined') {
  let prev = usePreferencesStore.getState();
  usePreferencesStore.subscribe((next) => {
    if (
      next.themeMode !== prev.themeMode ||
      next.accentColor !== prev.accentColor ||
      next.radiusScale !== prev.radiusScale
    ) {
      applyPreferences(next);
    }
    prev = next;
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (usePreferencesStore.getState().themeMode === 'system') {
      applyPreferences(usePreferencesStore.getState());
    }
  });
}

export default function App() {
  useEffect(() => {
    editorDocument.init(useEditorStore);
    const unsubLayerLifecycle = initLayerLifecycle();
    const unsubStatePersistence = initEditorStatePersistence();
    return () => {
      unsubStatePersistence();
      unsubLayerLifecycle();
      editorDocument.dispose();
    };
  }, []);

  // Re-init document facade when Vite HMR replaces the store module
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const handler = () => {
      editorDocument.dispose();
      editorDocument.init(useEditorStore);
    };
    hot.on('vite:afterUpdate', handler);
    return () => { hot.off('vite:afterUpdate', handler); };
  }, []);

  return (
    <ErrorBoundary
      label="app"
      fallback={(error, retry) => (
        <div className="fixed inset-0 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3 p-6 max-w-md bg-surface border border-separator rounded-[var(--radius-button)] shadow-md">
            <div className="text-text-primary font-medium">The editor crashed.</div>
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap text-[11px] text-text-secondary opacity-80">
              {error.message}
            </pre>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="px-3 py-1.5 text-[12px] rounded-[3px] bg-surface-secondary hover:bg-surface-secondary/80 border border-separator cursor-pointer"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 text-[12px] rounded-[3px] bg-accent text-accent-foreground hover:opacity-90 cursor-pointer"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <ReactFlowProvider>
        <EditorProvider>
          <EditorContent />
        </EditorProvider>
      </ReactFlowProvider>
    </ErrorBoundary>
  );
}
