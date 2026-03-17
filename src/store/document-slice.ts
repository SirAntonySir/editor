import type { StateCreator } from 'zustand';
import type { DocumentMeta } from '@/core/types';

export interface DocumentSlice {
  documentMeta: DocumentMeta | null;
  isDirty: boolean;

  setDocumentMeta: (meta: DocumentMeta | null) => void;
  setDirty: (dirty: boolean) => void;
}

export const createDocumentSlice: StateCreator<
  DocumentSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  documentMeta: null,
  isDirty: false,

  setDocumentMeta: (meta) =>
    set((state) => {
      state.documentMeta = meta;
    }),

  setDirty: (dirty) =>
    set((state) => {
      state.isDirty = dirty;
    }),
});
