import type { StateCreator } from 'zustand';

export interface ToolSlice {
  activeTool: string;
  toolConfigs: Record<string, unknown>;

  setActiveTool: (name: string) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'select',
  toolConfigs: {},

  setActiveTool: (name) =>
    set((state) => {
      state.activeTool = name;
    }),

  setToolConfig: (toolName, config) =>
    set((state) => {
      state.toolConfigs[toolName] = config;
    }),

  getToolConfig: <T = unknown>(toolName: string) => {
    return get().toolConfigs[toolName] as T | undefined;
  },
});
