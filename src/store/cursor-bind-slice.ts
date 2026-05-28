import { create } from 'zustand';
import type { Scope } from '@/types/scope';

export type PendingBind =
  | { kind: 'tool'; toolName: string; scope: Scope | null }
  | { kind: 'suggestion'; widgetId: string; scope: Scope | null };

interface CursorBindState {
  pending: PendingBind | null;
  cursor: { x: number; y: number } | null;
  startTool: (toolName: string, scope: Scope | null) => void;
  startSuggestion: (widgetId: string, scope: Scope | null) => void;
  updateCursor: (x: number, y: number) => void;
  cancel: () => void;
}

export const useCursorBindStore = create<CursorBindState>((set) => ({
  pending: null,
  cursor: null,
  startTool: (toolName, scope) =>
    set({ pending: { kind: 'tool', toolName, scope } }),
  startSuggestion: (widgetId, scope) =>
    set({ pending: { kind: 'suggestion', widgetId, scope } }),
  updateCursor: (x, y) => set({ cursor: { x, y } }),
  cancel: () => set({ pending: null, cursor: null }),
}));
