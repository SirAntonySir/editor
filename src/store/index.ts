import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { type LayerSlice, createLayerSlice } from './layer-slice';
import { type ViewportSlice, createViewportSlice } from './viewport-slice';
import { type ToolSlice, createToolSlice } from './tool-slice';

export type EditorState = LayerSlice & ViewportSlice & ToolSlice;

export const useEditorStore = create<EditorState>()(
  devtools(
    temporal(
      immer((set, get, store) => ({
        ...createLayerSlice(set as never, get as never, store as never),
        ...createViewportSlice(set as never, get as never, store as never),
        ...createToolSlice(set as never, get as never, store as never),
      })),
      {
        limit: 50,
        partialize: (state) => {
          const { layers, activeLayerId, pixelVersion } = state;
          return { layers, activeLayerId, pixelVersion };
        },
      }
    )
  )
);
