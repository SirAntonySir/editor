import { create } from 'zustand';

const MAX_ENTRIES = 20;

let stack: unknown[] = [];
let cursor = -1;

export function initWith<T>(snap: T): void {
  stack = [snap];
  cursor = 0;
  syncStore();
}

export function push<T>(snap: T): void {
  stack = stack.slice(0, cursor + 1);
  stack.push(snap);
  if (stack.length > MAX_ENTRIES) {
    stack = stack.slice(stack.length - MAX_ENTRIES);
  }
  cursor = stack.length - 1;
  syncStore();
}

export function undo<T>(): T | null {
  if (cursor <= 0) return null;
  cursor--;
  syncStore();
  return stack[cursor] as T;
}

export function redo<T>(): T | null {
  if (cursor >= stack.length - 1) return null;
  cursor++;
  syncStore();
  return stack[cursor] as T;
}

export function clear(): void {
  stack = [];
  cursor = -1;
  syncStore();
}

export function canUndo(): boolean {
  return cursor > 0;
}

export function canRedo(): boolean {
  return cursor < stack.length - 1;
}

// ─── Zustand store for reactive canUndo/canRedo ─────────────────────

export interface HistoryStoreState {
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
}

export const historyStore = create<HistoryStoreState>(() => ({
  canUndo: false,
  canRedo: false,
  revision: 0,
}));

function syncStore(): void {
  historyStore.setState({
    canUndo: canUndo(),
    canRedo: canRedo(),
    revision: cursor,
  });
}
