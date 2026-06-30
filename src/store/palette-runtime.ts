import { create } from 'zustand';
import type { PromptDoc } from '@/lib/prompt-doc';
import type { AttachedContextItem } from '@/lib/command-palette';

/** A snapshot of the editor input at submit time, kept so a FAILED turn can
 *  repopulate the palette when the user reopens it. */
export interface PaletteRestore {
  doc: PromptDoc;
  attachedContext: AttachedContextItem[];
}

export interface PaletteError {
  message: string;
  hint?: string;
}

/**
 * Runtime state for an in-flight Agent-mode turn, lifted OUT of `CommandPalette`
 * so it survives the dialog closing and is readable by the minimized pill
 * (`CommandTrigger`). The palette closes immediately on submit; this store is
 * what keeps the loading animation alive on the pill and lets a reopened
 * palette pick the in-flight (or failed) state back up.
 */
export interface PaletteRuntimeState {
  /** Submitted prompt text while a turn is in flight; null when idle. */
  pending: string | null;
  /** Sub-phase shown in the placeholder / pill while pending. */
  phase: 'analyze' | 'propose' | null;
  /** Set when the last turn failed; cleared on edit / new submit. */
  error: PaletteError | null;
  /** Editor snapshot to restore on reopen-after-failure. */
  restore: PaletteRestore | null;

  start(prompt: string, restore: PaletteRestore): void;
  setPhase(phase: 'analyze' | 'propose' | null): void;
  /** Successful turn — clear everything. */
  finish(): void;
  /** Failed turn — clear `pending`/`phase`, keep `restore`, set `error`. */
  fail(error: PaletteError): void;
  clearError(): void;
}

export const usePaletteRuntime = create<PaletteRuntimeState>((set) => ({
  pending: null,
  phase: null,
  error: null,
  restore: null,

  start: (prompt, restore) =>
    set({ pending: prompt, phase: null, error: null, restore }),
  setPhase: (phase) => set({ phase }),
  finish: () => set({ pending: null, phase: null, error: null, restore: null }),
  fail: (error) => set({ pending: null, phase: null, error }),
  clearError: () => set({ error: null }),
}));
