import type { StateCreator } from 'zustand';

export type FitMode = 'fit' | 'fill' | 'actual';
export type CompareLayout = 'horizontal' | 'vertical';

export interface ViewportSlice {
  zoom: number;
  panX: number;
  panY: number;
  canvasWidth: number;
  canvasHeight: number;
  fitMode: FitMode;
  showCompare: boolean;
  compareLayout: CompareLayout;

  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setCanvasDimensions: (width: number, height: number) => void;
  setFitMode: (mode: FitMode) => void;
  resetViewport: () => void;
  toggleCompare: () => void;
  setCompareLayout: (layout: CompareLayout) => void;
}

export const createViewportSlice: StateCreator<ViewportSlice, [['zustand/immer', never]], []> = (set) => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  fitMode: 'fit',
  showCompare: false,
  compareLayout: 'horizontal',

  setZoom: (zoom) =>
    set((state) => {
      state.zoom = Math.max(0.1, Math.min(32, zoom));
    }),

  setPan: (x, y) =>
    set((state) => {
      state.panX = x;
      state.panY = y;
    }),

  setCanvasDimensions: (width, height) =>
    set((state) => {
      state.canvasWidth = width;
      state.canvasHeight = height;
    }),

  setFitMode: (mode) =>
    set((state) => {
      state.fitMode = mode;
    }),

  resetViewport: () =>
    set((state) => {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.fitMode = 'fit';
    }),

  toggleCompare: () =>
    set((state) => {
      state.showCompare = !state.showCompare;
    }),

  setCompareLayout: (layout) =>
    set((state) => {
      state.compareLayout = layout;
    }),
});
