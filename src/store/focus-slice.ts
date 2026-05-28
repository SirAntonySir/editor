import { create } from 'zustand';

interface FocusState {
  focusedId: string | null;
  hoveredId: string | null;
  setFocused: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  clear: () => void;
}

export const useFocusedWidget = create<FocusState>((set) => ({
  focusedId: null,
  hoveredId: null,
  setFocused: (focusedId) => set({ focusedId }),
  setHovered: (hoveredId) => set({ hoveredId }),
  clear: () => set({ focusedId: null, hoveredId: null }),
}));
