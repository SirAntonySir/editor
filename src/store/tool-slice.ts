import type { StateCreator } from 'zustand';

export type EditorMode = 'develop' | 'compose';

export type ObjectSelectTool = 'point' | 'lasso';

export interface ToolSlice {
  activeTool: string;
  editorMode: EditorMode;
  /** How object mode selects: SAM point-click (default) or a freehand lasso
   *  polygon rasterized client-side (no SAM call). Shared across image nodes;
   *  only meaningful while a node's object mode is active. */
  objectSelectTool: ObjectSelectTool;
  setObjectSelectTool: (tool: ObjectSelectTool) => void;
  toolConfigs: Record<string, unknown>;
  expandedWidgetIds: Set<string>;
  expandedSectionIds: Set<string>;
  /** Adjustments-accordion section id (== ProcessingDefinition.id) that the UI
   *  should scroll into view once. Set by the command-palette baseline launcher
   *  (aiAccess=false routes op rows into the inspector instead of spawning a
   *  canvas widget); the AdjustmentsAccordion consumes + clears it. */
  sectionScrollTarget: string | null;
  hoveredWidgetId: string | null;
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
  /** ID of an object whose inline-rename input should auto-open when its
   *  label chip mounts. Set by the image-node ContextMenu's "Rename" item
   *  (which can't reach the label's local state directly) — the label
   *  consumes the value and clears it. */
  pendingObjectRenameId: string | null;
  requestObjectRename: (maskId: string) => void;
  clearObjectRenameRequest: (maskId: string) => void;

  /** Per-widget visible-bindings filter. When set for a widget id, the
   *  WidgetShell renders only the listed param keys instead of every binding.
   *  Wired by the per-slider Pin action so a pinned slider lands on the canvas
   *  as a one-control widget. */
  pinnedWidgetParams: Record<string, string[]>;
  setPinnedWidgetParams: (widgetId: string, paramKeys: string[]) => void;
  /** Pending per-slider Pin requests. The Pin button on a BindingRow can't
   *  know the soon-to-be-created widget id, so it stores the desired filter
   *  here keyed by `${layerId}:${opAdjustmentType}`. The widget.created
   *  handler in backend-state-slice drains the matching entry and applies it
   *  to `pinnedWidgetParams` for the new widget id. */
  pendingPinRequests: Record<string, string[]>;
  queuePinRequest: (layerId: string, opAdjustmentType: string, paramKeys: string[]) => void;
  consumePinRequest: (layerId: string, opAdjustmentType: string) => string[] | null;

  setActiveTool: (name: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  setToolConfig: (toolName: string, config: unknown) => void;
  getToolConfig: <T = unknown>(toolName: string) => T | undefined;
  toggleWidgetExpanded: (widgetId: string) => void;
  /** Force a widget open (used when a widget spawns — it spawns expanded). */
  expandWidget: (widgetId: string) => void;
  toggleSectionExpanded: (sectionId: string) => void;
  /** Force a section open (idempotent). Used by the baseline command-palette
   *  launcher so picking an op row deterministically opens its inspector
   *  section instead of spawning a canvas widget. */
  expandSection: (sectionId: string) => void;
  /** Request the AdjustmentsAccordion scroll a section into view. */
  scrollToSection: (sectionId: string) => void;
  /** Clear the pending scroll target (called by the accordion after scrolling). */
  consumeSectionScroll: () => void;
  collapseAllWidgets: () => void;
  setHoveredWidget: (widgetId: string | null) => void;
  markParamTouched: (key: string) => void;
}

export const createToolSlice: StateCreator<ToolSlice, [['zustand/immer', never]], []> = (set, get) => ({
  activeTool: 'select',
  editorMode: 'develop',
  objectSelectTool: 'point',
  toolConfigs: {},
  expandedWidgetIds: new Set<string>(),
  expandedSectionIds: new Set<string>(),
  sectionScrollTarget: null,
  hiddenWidgetIds: new Set<string>(),
  hiddenCanonNodeIds: new Set<string>(),
  hoveredWidgetId: null,
  cropPreview: null,
  touchedParams: new Set<string>(),
  pinnedWidgetParams: {},
  pendingPinRequests: {},
  pendingObjectRenameId: null,

  requestObjectRename: (maskId) =>
    set((state) => {
      state.pendingObjectRenameId = maskId;
    }),
  clearObjectRenameRequest: (maskId) =>
    set((state) => {
      if (state.pendingObjectRenameId === maskId) state.pendingObjectRenameId = null;
    }),

  setPinnedWidgetParams: (widgetId, paramKeys) =>
    set((state) => {
      state.pinnedWidgetParams[widgetId] = [...paramKeys];
    }),

  queuePinRequest: (layerId, opAdjustmentType, paramKeys) =>
    set((state) => {
      state.pendingPinRequests[`${layerId}:${opAdjustmentType}`] = [...paramKeys];
    }),

  consumePinRequest: (layerId, opAdjustmentType) => {
    const key = `${layerId}:${opAdjustmentType}`;
    const v = get().pendingPinRequests[key];
    if (!v) return null;
    set((state) => {
      delete state.pendingPinRequests[key];
    });
    return v;
  },

  setActiveTool: (name) =>
    set((state) => {
      state.activeTool = name;
    }),

  setObjectSelectTool: (tool) =>
    set((state) => {
      state.objectSelectTool = tool;
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

  expandSection: (sectionId) =>
    set((state) => {
      state.expandedSectionIds.add(sectionId);
    }),

  scrollToSection: (sectionId) =>
    set((state) => {
      state.sectionScrollTarget = sectionId;
    }),

  consumeSectionScroll: () =>
    set((state) => {
      state.sectionScrollTarget = null;
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

  setCropPreview: (p) =>
    set((state) => {
      state.cropPreview = p;
    }),
});
