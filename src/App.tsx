import { useRef, useCallback } from 'react';
import type * as fabric from 'fabric';
import { EditorProvider, useEditor } from '@/components/EditorProvider';
import { EditorCanvas, loadImageToCanvas } from '@/components/canvas/EditorCanvas';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { ToolRegistry } from '@/lib/tool-registry';
import { useEditorStore } from '@/store';
import { SelectTool } from '@/tools/select-tool';
import { CropTool } from '@/tools/crop-tool';
import { Upload } from 'lucide-react';

// Register tools
ToolRegistry.register(SelectTool);
ToolRegistry.register(CropTool);

function EditorContent({ canvasRef }: { canvasRef: React.MutableRefObject<fabric.Canvas | null> }) {
  const { toolContext, getActiveTool } = useEditor();
  const activeTool = useEditorStore((s) => s.activeTool);
  const layers = useEditorStore((s) => s.layers);
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
    <div className="flex flex-col h-full">
      {/* Top toolbar */}
      <div className="flex items-center justify-center p-1.5">
        <Toolbar />
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative">
        <EditorCanvas canvasRef={canvasRef} />

        {/* Tool canvas overlay */}
        {toolDef?.CanvasOverlay && (
          <toolDef.CanvasOverlay ctx={toolContext} />
        )}

        {/* Empty state */}
        {layers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <button
              onClick={handleFileOpen}
              className="glass-panel flex flex-col items-center gap-2 px-6 py-5 pointer-events-auto
                text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <Upload size={32} />
              <span className="text-sm">Open an image or drag & drop</span>
            </button>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-2 py-0.5 text-xs text-text-secondary bg-surface">
        <span>{activeTool}</span>
        <ZoomDisplay />
      </div>
    </div>
  );
}

function ZoomDisplay() {
  const zoom = useEditorStore((s) => s.zoom);
  return <span>{Math.round(zoom * 100)}%</span>;
}

export default function App() {
  const canvasRef = useRef<fabric.Canvas | null>(null);

  return (
    <EditorProvider canvasRef={canvasRef}>
      <EditorContent canvasRef={canvasRef} />
    </EditorProvider>
  );
}
