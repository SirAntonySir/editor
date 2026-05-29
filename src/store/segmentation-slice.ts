import type { StateCreator } from 'zustand';
import type { MaskRef } from '@/types/scope';

export type EncoderState = 'idle' | 'loading-model' | 'encoding' | 'ready' | 'error';

export interface SegmentationSlice {
  activeMaskRef: MaskRef | null;
  committedMaskRef: MaskRef | null;
  encoderState: EncoderState;

  setActiveMask: (ref: MaskRef | null) => void;
  commitMask: () => void;
  discardCommittedMask: () => void;
  setEncoderState: (s: EncoderState) => void;
}

export const createSegmentationSlice: StateCreator<
  SegmentationSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  activeMaskRef: null,
  committedMaskRef: null,
  encoderState: 'idle',

  setActiveMask: (ref) => set((state) => { state.activeMaskRef = ref; }),
  commitMask: () => set((state) => {
    state.committedMaskRef = state.activeMaskRef;
    state.activeMaskRef = null;
  }),
  discardCommittedMask: () => set((state) => { state.committedMaskRef = null; }),
  setEncoderState: (s) => set((state) => { state.encoderState = s; }),
});
