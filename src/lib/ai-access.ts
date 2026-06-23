import { useBackendState } from '@/store/backend-state-slice';

/**
 * Study-design gate for AI features. Mirrors the backend session constant
 * `AI_access` (surfaced on the snapshot as `aiAccess`), set per-session via the
 * admin cockpit.
 *
 * When false (the control condition), the three AI surfaces — analysis,
 * command-palette AI rows, and autonomous suggestions — are hidden. The static
 * tools (toolrail, Image → Adjustments, ⌘K op/preset search) stay available in
 * both conditions so the two can be compared.
 *
 * Defaults to true whenever the snapshot is absent (pre-session / empty canvas)
 * so normal first-load and dev behaviour is unchanged.
 */
export function useAiAccess(): boolean {
  return useBackendState((s) => s.snapshot?.aiAccess ?? true);
}

/** Non-reactive read for use outside React (e.g. keyboard-shortcut actions). */
export function getAiAccess(): boolean {
  return useBackendState.getState().snapshot?.aiAccess ?? true;
}
