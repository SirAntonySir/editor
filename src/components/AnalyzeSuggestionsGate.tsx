import { useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';

/**
 * On the rising edge of `mcpAnalyzeComplete`, snapshot every active
 * mcp_autonomous widget that hasn't already been engaged and mark them as
 * pending. The SuggestionChips component then renders one chip per pending
 * widget so the user can allow / deny each one independently.
 *
 * Widgets stay in the pending set (hidden from the inspector AI section and
 * the canvas) until the user resolves them via the chips. Renders nothing.
 */
export function AnalyzeSuggestionsGate() {
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const prevCompleteRef = useRef(false);

  useEffect(() => {
    const wasComplete = prevCompleteRef.current;
    prevCompleteRef.current = mcpComplete;
    if (!mcpComplete || wasComplete) return;

    const { snapshot, markPendingSuggestions } = useBackendState.getState();
    if (!snapshot) return;
    const ids = snapshot.widgets
      .filter((w) => w.status === 'active' && w.origin.kind === 'mcp_autonomous')
      .map((w) => w.id);
    if (ids.length === 0) return;
    markPendingSuggestions(ids);
  }, [mcpComplete]);

  return null;
}
