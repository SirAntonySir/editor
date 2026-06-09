import { useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useBackendState } from '@/store/backend-state-slice';
import { confirmToast } from '@/components/ui/ConfirmToast';
import { tetherWorkspaceWidgetOnEngage } from '@/lib/workspace-tether';
import { backendTools } from '@/lib/backend-tools';
import type { Widget } from '@/types/widget';

/**
 * Watches for analyze completion and, when AI suggestions arrive, prompts the
 * user with a confirm toast before they land on the canvas.
 *
 * The autonomous widgets always reach the backend snapshot — that's
 * non-blocking. This gate only governs whether they get an automatic canvas
 * footprint (Allow → tether each next to the active image node) or are
 * dismissed (Deny → delete_widget for each, removing them from the inspector
 * AI section too).
 *
 * Triggers exactly once per analyze run: on the rising edge of
 * `mcpAnalyzeComplete`, the autonomous widgets in the snapshot at that moment
 * are the batch. Subsequent analyze runs produce a fresh batch.
 *
 * Renders nothing.
 */
export function AnalyzeSuggestionsGate() {
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const rf = useReactFlow();
  const prevCompleteRef = useRef(false);

  useEffect(() => {
    const wasComplete = prevCompleteRef.current;
    prevCompleteRef.current = mcpComplete;
    if (!mcpComplete || wasComplete) return;

    // Rising edge: gather autonomous widgets currently in the snapshot. Take
    // a single snapshot read at the moment of completion — widgets added
    // afterward are out of this batch.
    const { snapshot, sessionId } = useBackendState.getState();
    if (!snapshot) return;
    const autonomous: Widget[] = snapshot.widgets.filter(
      (w) => w.status === 'active' && w.origin.kind === 'mcp_autonomous',
    );
    if (autonomous.length === 0) return;

    const count = autonomous.length;
    const text = `${count} AI suggestion${count === 1 ? '' : 's'} ready. Add to canvas?`;

    confirmToast.ask({
      text,
      allowLabel: 'Allow',
      denyLabel: 'Deny',
      onAllow: () => {
        const { x, y, zoom } = rf.getViewport();
        const screen = { w: window.innerWidth, h: window.innerHeight };
        const viewport = { pan: { x, y }, zoom, screen };
        for (const w of autonomous) {
          tetherWorkspaceWidgetOnEngage(w, viewport);
        }
      },
      onDeny: () => {
        if (!sessionId) return;
        for (const w of autonomous) {
          void backendTools.delete_widget(sessionId, {
            widget_id: w.id,
            suppress_similar: false,
          });
        }
      },
    });
  }, [mcpComplete, rf]);

  return null;
}
