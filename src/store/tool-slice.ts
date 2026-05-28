import type { StateCreator } from 'zustand';

export type EditorMode = 'develop' | 'compose';

export interface ToolSlice {
  activeTool: string;
  editorMode: EditorMode;
  toolConfigs: Record<string, unknown>;
  showHistoryPanel: boolean;
  layersSectionOpen: boolean;

  setActiveTool: (name: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
  toggleHistoryPanel: () => void;
  toggleLayersSection: () => void;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'select',
  editorMode: 'develop',
  toolConfigs: {},
  showHistoryPanel: false,
  layersSectionOpen: true,

  setActiveTool: (name) =>
    set((state) => {
      state.activeTool = name;
    }),

  setEditorMode: (mode) =>
    set((state) => {
      state.editorMode = mode;
      if (mode === 'compose') state.activeTool = 'select';
    }),

  setToolConfig: (toolName, config) =>
    set((state) => {
      state.toolConfigs[toolName] = config;
    }),

  getToolConfig: <T = unknown>(toolName: string) => {
    return get().toolConfigs[toolName] as T | undefined;
  },

  toggleHistoryPanel: () =>
    set((state) => {
      state.showHistoryPanel = !state.showHistoryPanel;
    }),

  toggleLayersSection: () =>
    set((state) => {
      state.layersSectionOpen = !state.layersSectionOpen;
    }),
});
