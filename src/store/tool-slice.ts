import type { StateCreator } from 'zustand';

export type EditorMode = 'develop' | 'compose';

export interface ToolSlice {
  activeTool: string;
  editorMode: EditorMode;
  toolConfigs: Record<string, unknown>;

  setActiveTool: (name: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'crop',
  editorMode: 'develop',
  toolConfigs: {},

  setActiveTool: (name) =>
    set((state) => {
      state.activeTool = name;
    }),

  setEditorMode: (mode) =>
    set((state) => {
      state.editorMode = mode;
      state.activeTool = mode === 'compose' ? 'select' : 'crop';
    }),

  setToolConfig: (toolName, config) =>
    set((state) => {
      state.toolConfigs[toolName] = config;
    }),

  getToolConfig: <T = unknown>(toolName: string) => {
    return get().toolConfigs[toolName] as T | undefined;
  },
});
