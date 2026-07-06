import { useBackendState } from '@/store/backend-state-slice';

/**
 * Study-design gate for the AI WIDGET LAYER. Mirrors the backend session
 * constant `AI_access` (surfaced on the snapshot as `aiAccess`), set per-session
 * via the admin cockpit. The manipulated variable is widgets-vs-no-widgets.
 *
 * When false (the baseline/control condition), only the AI-composed *parametric
 * widget layer* and its canvas manipulation are removed: autonomous suggestions,
 * command-palette AI/goal-prompt rows, Ask mode, smart_match, the analyze CTA,
 * the pin/"open on canvas" affordances, and canvas-widget spawning from palette
 * op/preset rows (those become a deterministic launcher INTO the sidebar
 * inspector instead).
 *
 * NOT gated — available in BOTH conditions: generative fill (it produces pixels,
 * not a parametric control), SAM/MobileSAM click-to-segment, lasso, the Objects
 * tools, the deterministic ⌘K op/preset/menu search + context chips, the sidebar
 * accordion inspector (writes canonical directly), presets, crop, layers,
 * history/undo.
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
