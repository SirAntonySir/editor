import type { StateCreator } from 'zustand';

export type EditorMode = 'develop' | 'compose';

export interface ToolSlice {
  activeTool: string;
  editorMode: EditorMode;
  toolConfigs: Record<string, unknown>;
  expandedWidgetIds: Set<string>;
  hoveredWidgetId: string | null;
  sessionDragOverrides: Map<string, { x: number; y: number }>;

  setActiveTool: (name: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
  toggleWidgetExpanded: (widgetId: string) => void;
  collapseAllWidgets: () => void;
  setHoveredWidget: (widgetId: string | null) => void;
  setDragOverride: (widgetId: string, pos: { x: number; y: number }) => void;
  clearDragOverride: (widgetId: string) => void;
  clearDragOverrides: () => void;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'select',
  editorMode: 'develop',
  toolConfigs: {},
  expandedWidgetIds: new Set<string>(),
  hoveredWidgetId: null,
  sessionDragOverrides: new Map<string, { x: number; y: number }>(),

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

  toggleWidgetExpanded: (widgetId) =>
    set((state) => {
      if (state.expandedWidgetIds.has(widgetId)) {
        state.expandedWidgetIds.delete(widgetId);
      } else {
        state.expandedWidgetIds.add(widgetId);
      }
    }),

  collapseAllWidgets: () =>
    set((state) => {
      state.expandedWidgetIds.clear();
    }),

  setHoveredWidget: (widgetId) =>
    set((state) => {
      state.hoveredWidgetId = widgetId;
    }),

  setDragOverride: (widgetId, pos) =>
    set((state) => {
      state.sessionDragOverrides.set(widgetId, pos);
    }),

  clearDragOverride: (widgetId) =>
    set((state) => {
      state.sessionDragOverrides.delete(widgetId);
    }),

  clearDragOverrides: () =>
    set((state) => {
      state.sessionDragOverrides.clear();
    }),
});
