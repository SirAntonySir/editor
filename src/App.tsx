import { useRef, useCallback, useEffect } from 'react';
import type * as fabric from 'fabric';
import { AnimatePresence } from 'framer-motion';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { EditorCanvas, loadImageToCanvas } from '@/components/canvas/EditorCanvas';

import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { MenuBar } from '@/components/toolbar/MenuBar';
import { RightSidebar } from '@/components/panels/RightSidebar';
import { PreferencesPage } from '@/components/PreferencesPage';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { registerAllProcessing } from '@/processing';
import { registerAllToolManifests } from '@/lib/tool-manifest';
import { useEditorStore } from '@/store';
import { usePreferencesStore, applyPreferences } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { initLayerLifecycle } from '@/core/layer-lifecycle';
import { LightTool } from '@/tools/light-tool';
import { ColorTool } from '@/tools/color-tool';
import { KelvinTool } from '@/tools/kelvin-tool';
import { CurvesTool } from '@/tools/curves-tool';
import { LevelsTool } from '@/tools/levels-tool';
import { FiltersTool } from '@/tools/filters-tool';
import { BackendStatusBar } from '@/components/ui/BackendStatusBar';
import { useBackendState } from '@/store/backend-state-slice';
import { SpawnPaletteWidget } from '@/components/widget/SpawnPaletteWidget';
import { CursorBindGhost } from '@/components/widget/CursorBindGhost';
import { useCursorBind } from '@/hooks/useCursorBind';
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

// Register tools (lean canvas-centric set — adjustment widget tools)
CanvasToolRegistry.register(LightTool);
CanvasToolRegistry.register(ColorTool);
CanvasToolRegistry.register(KelvinTool);
CanvasToolRegistry.register(CurvesTool);
CanvasToolRegistry.register(LevelsTool);
CanvasToolRegistry.register(FiltersTool);

/** Main canvas area */
function MainLayout({
  canvasRef,
  layers,
  toolDef,
  toolContext,
  activeTool,
  handleFileOpen,
}: {
  canvasRef: React.RefObject<fabric.Canvas | null>;
  layers: unknown[];
  toolDef: ReturnType<ReturnType<typeof useEditor>['getActiveTool']>;
  toolContext: ReturnType<typeof useEditor>['toolContext'];
  activeTool: string;
  handleFileOpen: () => void;
}) {
  return (
    <div className="relative flex-1 min-h-0 flex flex-row">
      <Toolbar />

      {/* Canvas column */}
      <div className="relative flex-1 min-w-0 min-h-0">
        <div className="absolute inset-0">
          <CanvasContextMenu>
            <div className="absolute inset-0">
              <EditorCanvas canvasRef={canvasRef} />
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
                    className="glass-panel px-4 py-2 text-sm text-text-primary hover:bg-surface-secondary transition-colors cursor-pointer"
                  >
                    Open Image
                  </button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </AnimatePresence>

        {/* Status bar — bottom-right of canvas column */}
        <div className="absolute bottom-0 right-0 z-20 flex items-center gap-2
          px-2 py-0.5 text-xs text-text-secondary bg-surface/70 backdrop-blur-sm rounded-tl-sm">
          <ScopeDisplay />
          <span className="text-separator">|</span>
          <span className="capitalize">{activeTool}</span>
          <span className="text-separator">|</span>
          <ZoomDisplay />
        </div>
      </div>

      <RightSidebar />
    </div>
  );
}

function EditorContent({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const layers = useEditorStore((s) => s.layers);
  const showPreferences = usePreferencesStore((s) => s.showPreferences);
  const toolDef = getActiveTool();

  // Cursor-bind: track cursor + ESC handling while a tool/suggestion is bound.
  useCursorBind();

  // ⌘K opens the floating spawn palette (SpawnPaletteWidget).
  // Disabled when the backend SSE connection is not open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const { sseStatus } = useBackendState.getState();
        if (sseStatus !== 'open') return;
        window.dispatchEvent(new CustomEvent('spawn-palette:open'));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleFileOpen = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await loadImageToCanvas(file, canvasRef.current);
      }
    };
    input.click();
  }, [canvasRef]);

  return (
    <div className="relative flex flex-col h-full">
      <KeyboardShortcuts />

      {/* Menu bar — fixed at top */}
      <div className="relative z-30 flex-none h-[24px] flex items-center px-1 bg-surface border-b border-separator">
        <MenuBar canvasRef={canvasRef} />
      </div>

      <BackendStatusBar />

      {/* Main canvas area */}
      <MainLayout
        canvasRef={canvasRef}
        layers={layers}
        toolDef={toolDef}
        toolContext={toolContext}
        activeTool={activeTool}
        handleFileOpen={handleFileOpen}
      />

      {/* Preferences overlay */}
      <AnimatePresence>
        {showPreferences && <PreferencesPage />}
      </AnimatePresence>

      {/* Floating spawn palette — opened via ⌘K */}
      <SpawnPaletteWidget />

      {/* Cursor-bind ghost — follows the cursor while a tool/suggestion is bound */}
      <CursorBindGhost />
    </div>
  );
}

function ZoomDisplay() {
  const zoom = useEditorStore((s) => s.zoom);
  return <span>{Math.round(zoom * 100)}%</span>;
}

function ScopeDisplay() {
  const activeScope = useEditorStore((s) => s.activeScope);
  if (!activeScope || activeScope.kind === 'global') {
    return <span style={{ color: 'var(--color-accent)' }}>image</span>;
  }
  if (activeScope.kind === 'mask') {
    return <span style={{ color: '#ff9f0a' }}>segment</span>;
  }
  return <span>—</span>;
}

// Apply persisted preferences on initial load
applyPreferences(usePreferencesStore.getState());

export default function App() {
  const canvasRef = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    editorDocument.init(useEditorStore);
    const unsubLayerLifecycle = initLayerLifecycle();
    return () => {
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
    <EditorProvider canvasRef={canvasRef}>
      <EditorContent canvasRef={canvasRef} />
    </EditorProvider>
  );
}
