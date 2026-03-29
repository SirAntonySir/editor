import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface CropEditingState {
  isCropEditing: boolean;
  cropAspectRatio: number;     // 0 = free
  cropStraighten: number;      // -45 to +45
  cropBaseRotation: number;    // 0, 90, 180, 270
  cropFlipX: boolean;
  cropFlipY: boolean;

  setIsCropEditing: (editing: boolean) => void;
  setCropAspectRatio: (ratio: number) => void;
  setCropStraighten: (degrees: number) => void;
  setCropBaseRotation: (degrees: number) => void;
  setCropFlipX: (flip: boolean) => void;
  setCropFlipY: (flip: boolean) => void;
  resetCropEditing: () => void;
}

export const useCropEditingStore = create<CropEditingState>()(
  devtools(
    immer((set) => ({
      isCropEditing: false,
      cropAspectRatio: 0,
      cropStraighten: 0,
      cropBaseRotation: 0,
      cropFlipX: false,
      cropFlipY: false,

      setIsCropEditing: (editing) =>
        set((state) => {
          state.isCropEditing = editing;
        }),

      setCropAspectRatio: (ratio) =>
        set((state) => {
          state.cropAspectRatio = ratio;
        }),

      setCropStraighten: (degrees) =>
        set((state) => {
          state.cropStraighten = degrees;
        }),

      setCropBaseRotation: (degrees) =>
        set((state) => {
          state.cropBaseRotation = degrees;
        }),

      setCropFlipX: (flip) =>
        set((state) => {
          state.cropFlipX = flip;
        }),

      setCropFlipY: (flip) =>
        set((state) => {
          state.cropFlipY = flip;
        }),

      resetCropEditing: () =>
        set((state) => {
          state.isCropEditing = false;
          state.cropAspectRatio = 0;
          state.cropStraighten = 0;
          state.cropBaseRotation = 0;
          state.cropFlipX = false;
          state.cropFlipY = false;
        }),
    })),
    { name: 'crop-editing' },
  ),
);
