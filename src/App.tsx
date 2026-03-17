import { useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import type * as fabric from 'fabric';
import { AnimatePresence } from 'framer-motion';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { EditorCanvas, loadImageToCanvas } from '@/components/canvas/EditorCanvas';
import { CompareOverlay } from '@/components/canvas/CompareOverlay';
import { CanvasContextMenu } from '@/components/canvas/CanvasContextMenu';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { MenuBar } from '@/components/toolbar/MenuBar';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { LayersPanel } from '@/components/panels/LayersPanel';
import { HistoryPanel } from '@/components/panels/HistoryPanel';
import { PreferencesPage } from '@/components/PreferencesPage';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { ToolRegistry } from '@/lib/tool-registry';
import { useEditorStore } from '@/store';
import { usePreferencesStore, applyPreferences } from '@/store/preferences-store';
import { editorDocument } from '@/core/document';
import { SelectTool } from '@/tools/select-tool';
import { MoveTool } from '@/tools/move-tool';
import { TransformTool } from '@/tools/transform-tool';
import { CropTool } from '@/tools/crop-tool';
import { LightTool } from '@/tools/light-tool';
import { ColorTool } from '@/tools/color-tool';
import { KelvinTool } from '@/tools/kelvin-tool';
import { CurvesTool } from '@/tools/curves-tool';
import { LevelsTool } from '@/tools/levels-tool';
import { BrushTool } from '@/tools/brush-tool';
import { TextTool } from '@/tools/text-tool';
import { FiltersTool } from '@/tools/filters-tool';
import { Upload } from 'lucide-react';

// Lazy-load GraphEditor so @xyflow/react CSS doesn't interfere with Fabric.js canvas
const GraphEditor = lazy(() =>
  import('@/components/graph/GraphEditor').then((m) => ({ default: m.GraphEditor })),
);
import { GraphSplitDivider } from '@/components/graph/GraphSplitDivider';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';

// Register tools
ToolRegistry.register(SelectTool);
ToolRegistry.register(MoveTool);
ToolRegistry.register(TransformTool);
ToolRegistry.register(CropTool);
ToolRegistry.register(LightTool);
ToolRegistry.register(ColorTool);
ToolRegistry.register(KelvinTool);
ToolRegistry.register(CurvesTool);
ToolRegistry.register(LevelsTool);
ToolRegistry.register(BrushTool);
ToolRegistry.register(TextTool);
ToolRegistry.register(FiltersTool);

/** Main canvas area — switches between full canvas and split canvas+graph */
function GraphSplitLayout({
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
  const splitRatio = useEditorStore((s) => s.graphSplitRatio);
  const splitDirection = useEditorStore((s) => s.graphSplitDirection);
  const setGraphSplitRatio = useEditorStore((s) => s.setGraphSplitRatio);
  const showCompare = useEditorStore((s) => s.showCompare);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        className={isGraph ? `flex h-full ${splitDirection === 'vertical' ? 'flex-row' : 'flex-col'}` : 'h-full'}
      >
        {/* Canvas pane — always at same tree position to avoid remounting Fabric */}
        <div
          className={isGraph ? 'relative min-w-0 min-h-0 overflow-hidden pointer-events-none' : 'absolute inset-0'}
          style={isGraph ? { flex: `0 0 ${splitRatio * 100}%` } : undefined}
        >
          <CanvasContextMenu>
            <div className="absolute inset-0">
              <EditorCanvas canvasRef={canvasRef} />
            </div>
          </CanvasContextMenu>
        </div>

        {/* Divider + Graph pane — only in graph mode */}
        {isGraph && (
          <Suspense
            fallback={
              <>
                <div className={`flex-none ${splitDirection === 'vertical' ? 'w-1' : 'h-1'} bg-separator`} />
                <div className="flex-1 bg-canvas-bg" />
              </>
            }
          >
            <GraphSplitDivider direction={splitDirection} onRatioChange={setGraphSplitRatio} />
            <div className="flex-1 min-w-0 min-h-0 relative bg-canvas-bg">
              <GraphEditor />
            </div>
          </Suspense>
        )}
      </div>

      {/* Tool canvas overlay — not in graph mode */}
      {!isGraph && toolDef?.CanvasOverlay && <toolDef.CanvasOverlay ctx={toolContext} />}

      {/* Compare before/after overlay */}
      {!isGraph && showCompare && layers.length > 0 && <CompareOverlay canvasRef={canvasRef} />}

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

      {/* HUDs — hidden in graph mode */}
      {!isGraph && (
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
            <span className="capitalize">{activeTool}</span>
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
      <GraphSplitLayout
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
    return () => editorDocument.dispose();
  }, []);

  return (
    <EditorProvider canvasRef={canvasRef}>
      <EditorContent canvasRef={canvasRef} />
    </EditorProvider>
  );
}
