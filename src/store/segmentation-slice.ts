import type { StateCreator } from 'zustand';

export type EncoderState = 'idle' | 'loading-model' | 'encoding' | 'ready' | 'error';

export interface SegmentationSlice {
  encoderState: EncoderState;
  setEncoderState: (s: EncoderState) => void;
}

export const createSegmentationSlice: StateCreator<
  SegmentationSlice,
  [['zustand/immer', never]],
  []
> = (set) => ({
  encoderState: 'idle',
  setEncoderState: (s) => set((state) => { state.encoderState = s; }),
});
