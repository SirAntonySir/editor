import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';

/**
 * Auto-tether autonomous AI suggestion widgets onto the canvas the moment
 * they land in the snapshot — but only AFTER the user explicitly allows them
 * via the SuggestionChips strip. Widgets in `pendingSuggestionIds` are
 * skipped; the user resolves them one chip at a time, at which point
 * SuggestionChips itself calls `tetherWorkspaceWidgetOnEngage`. This hook
 * therefore only fires for widgets that were never pending — e.g. ones
 * carried over from a prior session, or restored from disk — and uses
 * `acceptedSuggestions` so each id is tethered exactly once across the
 * lifetime of the editor.
 */
export function useAutoTetherAiSuggestions(): void {
  const rf = useReactFlow();
  // The aiKey selector still walks the backend snapshot; the pending
  // lookup is via useSuggestionsUi.getState() so this selector only
  // re-fires when the snapshot widgets list changes (not when pending
  // churns — that's handled inside the effect).
  const aiKey = useBackendState((s) => {
    const widgets = s.snapshot?.widgets ?? [];
    const pending = useSuggestionsUi.getState().pendingSuggestionIds;
    return widgets
      .filter(
        (w) =>
          (w.status === 'active' || w.status === 'accepted')
          && w.origin.kind === 'mcp_autonomous'
          && !pending.has(w.id),
      )
      .map((w) => w.id)
      .join(',');
  });

  useEffect(() => {
    if (!aiKey) return;
    const bs = useBackendState.getState();
    const ui = useSuggestionsUi.getState();
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    const viewport = { pan: { x, y }, zoom, screen };
    for (const id of aiKey.split(',')) {
      if (ui.acceptedSuggestions.has(id)) continue;
      if (ui.pendingSuggestionIds.has(id)) continue;
      const w = bs.snapshot?.widgets.find((x) => x.id === id);
      if (!w) continue;
      ui.addAcceptedSuggestion(id);
      tetherWorkspaceWidgetOnEngage(w, viewport);
    }
  }, [aiKey, rf]);
}
