import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from 'react';
import type * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useBackendSession } from '@/hooks/useBackendSession';
import { useSegmentInteraction } from '@/hooks/useSegmentInteraction';
import type { ToolContext, ToolDefinition } from '@/types/tool';

interface EditorContextValue {
  registry: typeof CanvasToolRegistry;
  toolContext: ToolContext;
  getActiveTool: () => ToolDefinition | undefined;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor must be used within EditorProvider');
  return ctx;
}

interface EditorProviderProps {
  children: ReactNode;
  canvasRef: React.RefObject<fabric.Canvas | null>;
}

export function EditorProvider({ children, canvasRef }: EditorProviderProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const previousToolRef = useRef<string | null>(null);

  // Dark-ship the backend state slice; rendering still uses legacy paths
  // until Task 11 mounts the new InspectorPanel.
  useBackendSession();
  useSegmentInteraction(canvasRef);

  const dispatchCommand = useCallback(
    (toolName: string, commandName: string, payload?: unknown) => {
      const tool = CanvasToolRegistry.get(toolName);
      const command = tool?.commands?.[commandName];
      if (!command) return;

      const state = useEditorStore.getState();
      const result = command.execute(state, payload);
      useEditorStore.setState(result.newState);
    },
    []
  );

  const toolContext: ToolContext = {
    canvasRef,
    getState: useEditorStore.getState,
    setState: useEditorStore.setState,
    dispatchCommand,
  };

  const getActiveTool = useCallback(() => {
    const { activeTool } = useEditorStore.getState();
    return CanvasToolRegistry.get(activeTool);
  }, []);

  // Handle tool lifecycle (activate/deactivate)
  const activeTool = useEditorStore((s) => s.activeTool);

  useEffect(() => {
    if (previousToolRef.current && previousToolRef.current !== activeTool) {
      const prevTool = CanvasToolRegistry.get(previousToolRef.current);
      cleanupRef.current?.();
      cleanupRef.current = null;
      prevTool?.onDeactivate?.(toolContext);
    }

    const currentTool = CanvasToolRegistry.get(activeTool);
    const cleanup = currentTool?.onActivate?.(toolContext);
    if (typeof cleanup === 'function') {
      cleanupRef.current = cleanup;
    }

    previousToolRef.current = activeTool;

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  return (
    <EditorContext.Provider value={{ registry: CanvasToolRegistry, toolContext, getActiveTool }}>
      {children}
    </EditorContext.Provider>
  );
}
