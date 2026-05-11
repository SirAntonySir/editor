import { useRef, useCallback, useEffect, useState, lazy, Suspense } from 'react';
import type * as fabric from 'fabric';
import { AnimatePresence } from 'framer-motion';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { EditorCanvas, loadImageToCanvas } from '@/components/canvas/EditorCanvas';

import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { MenuBar } from '@/components/toolbar/MenuBar';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { LayersPanel } from '@/components/panels/LayersPanel';
import { HistoryPanel } from '@/components/panels/HistoryPanel';
import { PreferencesPage } from '@/components/PreferencesPage';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { ToolRegistry } from '@/lib/tool-registry';
import { registerAllProcessing } from '@/processing';
import { registerAllNodes } from '@/components/graph/registerNodes';
import { initNodeTypes } from '@/components/graph/nodeTypes';
import { useEditorStore } from '@/store';
import { usePreferencesStore, applyPreferences } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { initLayerLifecycle } from '@/core/layer-lifecycle';
import { SelectTool } from '@/tools/select-tool';
import { MoveTool } from '@/tools/move-tool';
import { TransformTool } from '@/tools/transform-tool';
import { CropCanvasOverlay } from '@/components/canvas/CropOverlay';
import { useCropEditingStore } from '@/store/crop-editing-slice';
import { LightTool } from '@/tools/light-tool';
import { ColorTool } from '@/tools/color-tool';
import { KelvinTool } from '@/tools/kelvin-tool';
import { CurvesTool } from '@/tools/curves-tool';
import { LevelsTool } from '@/tools/levels-tool';
import { BrushTool } from '@/tools/brush-tool';
import { TextTool } from '@/tools/text-tool';
import { FiltersTool } from '@/tools/filters-tool';
import { CropTool } from '@/tools/crop-tool';
import { AnalyseIndicator } from '@/components/ui/AnalyseIndicator';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { useAiSession } from '@/hooks/useImageContext';
import { generatePanel } from '@/lib/ai-client';
import { addAiPanelLayer } from '@/store/ai-panel-actions';
import { Upload } from 'lucide-react';

// Lazy-load GraphEditor so @xyflow/react CSS doesn't interfere with Fabric.js canvas
const GraphEditor = lazy(() =>
  import('@/components/graph/GraphEditor').then((m) => ({ default: m.GraphEditor })),
);
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

// Register tools
ToolRegistry.register(SelectTool);
ToolRegistry.register(MoveTool);
ToolRegistry.register(TransformTool);
ToolRegistry.register(LightTool);
ToolRegistry.register(ColorTool);
ToolRegistry.register(KelvinTool);
ToolRegistry.register(CurvesTool);
ToolRegistry.register(LevelsTool);
ToolRegistry.register(BrushTool);
ToolRegistry.register(TextTool);
ToolRegistry.register(FiltersTool);
ToolRegistry.register(CropTool);

// Register all node definitions (structural + processing) into NodeRegistry
registerAllNodes();

// Build graph node types from NodeRegistry (must happen after all nodes are registered)
initNodeTypes();

/** Main canvas area — switches between full canvas and full-screen graph */
function MainLayout({
  canvasRef,
  editorMode,
  layers,
  toolDef,
  toolContext,
  activeTool,
  showHistoryPanel,
  handleFileOpen,
}: {
  canvasRef: React.RefObject<fabric.Canvas | null>;
  editorMode: string;
  layers: unknown[];
  toolDef: ReturnType<ReturnType<typeof useEditor>['getActiveTool']>;
  toolContext: ReturnType<typeof useEditor>['toolContext'];
  activeTool: string;
  showHistoryPanel: boolean;
  handleFileOpen: () => void;
}) {
  const isGraph = editorMode === 'graph' && layers.length > 0;
  const isCropEditing = useCropEditingStore((s) => s.isCropEditing);
  const showHUD = !isGraph;

  return (
    <div className="relative flex-1 min-h-0">
      {/* Canvas pane — always mounted to avoid remounting Fabric.
          In graph mode: hidden but kept in DOM so the pipeline stays active. */}
      <div className={isGraph ? 'w-0 h-0 overflow-hidden absolute' : 'absolute inset-0'}>
        <CanvasContextMenu>
          <div className="absolute inset-0">
            <EditorCanvas canvasRef={canvasRef} />
          </div>
        </CanvasContextMenu>
      </div>

      {/* Graph pane — full screen in graph mode */}
      {isGraph && (
        <Suspense fallback={<div className="absolute inset-0 bg-canvas-bg" />}>
          <div className="absolute inset-0 bg-canvas-bg">
            <GraphEditor />
          </div>
        </Suspense>
      )}

      {/* Crop canvas overlay — shown when crop editing is active (any mode) */}
      {isCropEditing && <CropCanvasOverlay canvasRef={canvasRef} />}

      {/* Tool canvas overlay — not in graph or crop editing mode */}
      {showHUD && !isCropEditing && toolDef?.CanvasOverlay && <toolDef.CanvasOverlay ctx={toolContext} />}

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

      {/* AI analyse status indicator — floats above all modes */}
      <AnalyseIndicator />

      {/* HUDs — hidden in graph mode */}
      {showHUD && (
        <>
          {/* Top toolbar */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
            <Toolbar />
          </div>

          {/* Layers panel — only in compose mode */}
          {editorMode === 'compose' && layers.length > 0 && <LayersPanel />}

          {/* History panel — toggled via View menu */}
          {showHistoryPanel && layers.length > 0 && <HistoryPanel />}

          {/* Inspector panel */}
          <InspectorPanel />

          {/* Status bar */}
          <div className="absolute bottom-0 right-0 z-20 flex items-center gap-2
            px-2 py-0.5 text-xs text-text-secondary bg-surface/70 backdrop-blur-sm rounded-tl-sm">
            <span className="capitalize">{isCropEditing ? 'crop' : activeTool}</span>
            <span className="text-separator">|</span>
            <ZoomDisplay />
          </div>
        </>
      )}
    </div>
  );
}

function EditorContent({ canvasRef }: { canvasRef: React.RefObject<fabric.Canvas | null> }) {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const editorMode = useEditorStore((s) => s.editorMode);
  const showHistoryPanel = useEditorStore((s) => s.showHistoryPanel);
  const layers = useEditorStore((s) => s.layers);
  const showPreferences = usePreferencesStore((s) => s.showPreferences);
  const toolDef = getActiveTool();

  // Command palette — Cmd+K opens regardless of editor state; disabled until a session exists.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const sessionId = useAiSession((s) => s.sessionId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handlePaletteSubmit = useCallback(
    async (text: string) => {
      if (!sessionId) return;
      try {
        const graph = await generatePanel(sessionId, text);
        addAiPanelLayer(graph);
      } catch (err) {
        console.error(err);
      }
    },
    [sessionId],
  );

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
      <div className="relative z-30 flex-none h-[24px] flex items-center px-1 bg-canvas-bg">
        <MenuBar canvasRef={canvasRef} />
      </div>

      {/* Main canvas area */}
      <MainLayout
        canvasRef={canvasRef}
        editorMode={editorMode}
        layers={layers}
        toolDef={toolDef}
        toolContext={toolContext}
        activeTool={activeTool}
        showHistoryPanel={showHistoryPanel}
        handleFileOpen={handleFileOpen}
      />

      {/* Preferences overlay */}
      <AnimatePresence>
        {showPreferences && <PreferencesPage />}
      </AnimatePresence>

      {/* Cmd+K command palette — submits user goal to /api/panel and inserts an ai-panel layer */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSubmit={handlePaletteSubmit}
        disabled={!sessionId}
      />
    </div>
  );
}

function ZoomDisplay() {
  const zoom = useEditorStore((s) => s.zoom);
  return <span>{Math.round(zoom * 100)}%</span>;
}

// Apply persisted preferences on initial load
applyPreferences(usePreferencesStore.getState());

export default function App() {
  const canvasRef = useRef<fabric.Canvas | null>(null);

  useEffect(() => {
    editorDocument.init(useEditorStore);
    const unsubLayerLifecycle = initLayerLifecycle();
    // Restore previous session if one exists
    editorDocument.restoreSession().catch(() => {});
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
      editorDocument.restoreSession().catch(() => {});
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
