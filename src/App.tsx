import { useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ReactFlowProvider } from '@xyflow/react';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { CanvasWorkspace } from '@/components/workspace/CanvasWorkspace';

import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { FloatingDock } from '@/components/ui/FloatingDock';
import { CommandPalette } from '@/components/CommandPalette';
import { MenuBar } from '@/components/toolbar/MenuBar';
import { RightSidebar } from '@/components/panels/RightSidebar';
import { PreferencesPage } from '@/components/PreferencesPage';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { registerAllProcessing } from '@/processing';
import { registerAllToolManifests } from '@/lib/tool-manifest';
import { useEditorStore } from '@/store';
import { usePreferencesStore, applyPreferences } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { initLayerLifecycle } from '@/core/layer-lifecycle';
import { initEditorStatePersistence } from '@/core/editor-state-persistence';
import { CurvesTool } from '@/tools/curves-tool';
import { LevelsTool } from '@/tools/levels-tool';
import { HslTool } from '@/tools/hsl-tool';
import { TimeOfDayTool } from '@/tools/time-of-day-tool';
import { useBackendState } from '@/store/backend-state-slice';
import { Upload } from 'lucide-react';

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';

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
      {/* Canvas column */}
      <div className="relative flex-1 min-w-0 min-h-0">
        <div className="absolute inset-0">
          <CanvasContextMenu>
            <div className="absolute inset-0">
              <CanvasWorkspace />
            </div>
          </CanvasContextMenu>
        </div>

        {/* Tool canvas overlay */}
        {toolDef?.CanvasOverlay && <toolDef.CanvasOverlay ctx={toolContext} />}

        {/* Empty state */}
        <AnimatePresence>
          {layers.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <Empty className="pointer-events-auto">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Upload />
                  </EmptyMedia>
                  <EmptyTitle>No image loaded</EmptyTitle>
                  <EmptyDescription>
                    Open an image to start editing, or drag & drop a file onto the canvas.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <button
                    onClick={handleFileOpen}
                    className="bg-surface border border-separator rounded-[var(--radius-button)] px-4 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors cursor-pointer"
                  >
                    Open Image
                  </button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </AnimatePresence>

      </div>

      <RightSidebar />
    </div>
  );
}

function EditorContent() {
  const { toolContext, getActiveTool } = useEditor();
  const layers = useEditorStore((s) => s.layers);
  const showPreferences = usePreferencesStore((s) => s.showPreferences);
  const toolDef = getActiveTool();

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
        const { sseStatus } = useBackendState.getState();
        if (sseStatus !== 'open') return;
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

  const handleFileOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await editorDocument.openImage(file);
      }
    };
    input.click();
  }, []);

  return (
    <div className="relative flex flex-col h-full">
      <KeyboardShortcuts />
      <CommandPalette />

      {/* Menu bar — fixed at top */}
      <div className="relative z-30 flex-none h-[24px] flex items-center px-1 bg-surface border-b border-separator">
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

      {/* Preferences overlay */}
      <AnimatePresence>
        {showPreferences && <PreferencesPage />}
      </AnimatePresence>
    </div>
  );
}

// Apply persisted preferences on initial load
applyPreferences(usePreferencesStore.getState());

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
    <ReactFlowProvider>
      <EditorProvider>
        <EditorContent />
      </EditorProvider>
    </ReactFlowProvider>
  );
}
