import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { type LayerSlice, createLayerSlice } from './layer-slice';
import { type ViewportSlice, createViewportSlice } from './viewport-slice';
import { type ToolSlice, createToolSlice } from './tool-slice';
import { type DocumentSlice, createDocumentSlice } from './document-slice';
import { type SegmentationSlice, createSegmentationSlice } from './segmentation-slice';

export type EditorState = LayerSlice &
  ViewportSlice &
  ToolSlice &
  DocumentSlice &
  SegmentationSlice;

export const useEditorStore = create<EditorState>()(
  devtools(
    immer((set, get, store) => ({
      ...createLayerSlice(set as never, get as never, store as never),
      ...createViewportSlice(set as never, get as never, store as never),
      ...createToolSlice(set as never, get as never, store as never),
      ...createDocumentSlice(set as never, get as never, store as never),
      ...createSegmentationSlice(set as never, get as never, store as never),
    }))
  )
);
