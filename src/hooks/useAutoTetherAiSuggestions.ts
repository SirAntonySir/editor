import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';

/**
 * Auto-tether autonomous AI suggestion widgets onto the canvas the moment
 * they land in the snapshot, regardless of which inspector tab is active.
 *
 * Previously this effect lived inside `AdjustmentsAccordion`, so widgets
 * only got their canvas footprint when the user happened to be on the
 * Adjustments tab when analyze finished. Switching tabs while analyze was
 * running (or starting on the Info tab and never visiting Adjustments)
 * left the suggestions unrendered on the canvas. Mounting the effect in
 * EditorProvider runs it for the full lifetime of the editor.
 *
 * Guarded by `acceptedSuggestions` so each widget is tethered exactly once.
 */
export function useAutoTetherAiSuggestions(): void {
  const rf = useReactFlow();
  const aiKey = useBackendState((s) =>
    (s.snapshot?.widgets ?? [])
      .filter(
        (w) =>
          (w.status === 'active' || w.status === 'accepted')
          && w.origin.kind === 'mcp_autonomous',
      )
      .map((w) => w.id)
      .join(','),
  );

  useEffect(() => {
    if (!aiKey) return;
    const bs = useBackendState.getState();
    const { x, y, zoom } = rf.getViewport();
    const screen = { w: window.innerWidth, h: window.innerHeight };
    const viewport = { pan: { x, y }, zoom, screen };
    for (const id of aiKey.split(',')) {
      if (bs.acceptedSuggestions.has(id)) continue;
      const w = bs.snapshot?.widgets.find((x) => x.id === id);
      if (!w) continue;
      bs.addAcceptedSuggestion(id);
      tetherWorkspaceWidgetOnEngage(w, viewport);
    }
  }, [aiKey, rf]);
}
