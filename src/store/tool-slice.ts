import type { StateCreator } from 'zustand';

export type EditorMode = 'develop' | 'compose';

export interface ToolSlice {
  activeTool: string;
  editorMode: EditorMode;
  toolConfigs: Record<string, unknown>;
  expandedWidgetIds: Set<string>;
  expandedSectionIds: Set<string>;
  hoveredWidgetId: string | null;
  cropModalImageNodeId: string | null;
  setCropModal: (id: string | null) => void;
  cropPreview: { crop: { x: number; y: number; w: number; h: number } | null;
                 rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null } | null;
  setCropPreview: (
    p: { crop: { x: number; y: number; w: number; h: number } | null;
         rotate: { angle: number; flip_h: boolean; flip_v: boolean } | null } | null
  ) => void;
  hiddenWidgetIds: Set<string>;
  toggleWidgetHidden: (widgetId: string) => void;
  hiddenCanonNodeIds: Set<string>;
  toggleCanonNodeHidden: (canonId: string) => void;
  /** Canonical `${layer}:${op}:${param}` keys the USER has moved by hand.
   * Drives slider provenance colour (hand = accent vs AI = violet). */
  touchedParams: Set<string>;

  setActiveTool: (name: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
  toggleWidgetExpanded: (widgetId: string) => void;
  /** Force a widget open (used when a widget spawns — it spawns expanded). */
  expandWidget: (widgetId: string) => void;
  toggleSectionExpanded: (sectionId: string) => void;
  collapseAllWidgets: () => void;
  setHoveredWidget: (widgetId: string | null) => void;
  markParamTouched: (key: string) => void;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'select',
  editorMode: 'develop',
  toolConfigs: {},
  expandedWidgetIds: new Set<string>(),
  expandedSectionIds: new Set<string>(),
  hiddenWidgetIds: new Set<string>(),
  hiddenCanonNodeIds: new Set<string>(),
  hoveredWidgetId: null,
  cropModalImageNodeId: null,
  cropPreview: null,
  touchedParams: new Set<string>(),

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

  toggleWidgetHidden: (widgetId) =>
    set((state) => {
      if (state.hiddenWidgetIds.has(widgetId)) {
        state.hiddenWidgetIds.delete(widgetId);
      } else {
        state.hiddenWidgetIds.add(widgetId);
      }
    }),

  toggleCanonNodeHidden: (canonId) =>
    set((state) => {
      if (state.hiddenCanonNodeIds.has(canonId)) {
        state.hiddenCanonNodeIds.delete(canonId);
      } else {
        state.hiddenCanonNodeIds.add(canonId);
      }
    }),

  expandWidget: (widgetId) =>
    set((state) => {
      state.expandedWidgetIds.add(widgetId);
    }),

  toggleSectionExpanded: (sectionId) =>
    set((state) => {
      if (state.expandedSectionIds.has(sectionId)) {
        state.expandedSectionIds.delete(sectionId);
      } else {
        state.expandedSectionIds.add(sectionId);
      }
    }),

  markParamTouched: (key) =>
    set((state) => {
      state.touchedParams.add(key);
    }),

  collapseAllWidgets: () =>
    set((state) => {
      state.expandedWidgetIds.clear();
    }),

  setHoveredWidget: (widgetId) =>
    set((state) => {
      state.hoveredWidgetId = widgetId;
    }),

  setCropModal: (id) =>
    set((state) => {
      state.cropModalImageNodeId = id;
    }),

  setCropPreview: (p) =>
    set((state) => {
      state.cropPreview = p;
    }),
});
