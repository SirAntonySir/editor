import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

interface PromoteOnlyBodyProps {
  toolId: string;
}

export function PromoteOnlyBody({ toolId }: PromoteOnlyBodyProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const layerId = useEditorStore((s) => s.activeLayerId);

  function open() {
    if (!sessionId || offline || !layerId) return;
    void backendTools.propose_widget(sessionId, {
      intent: toolId,
      scope: { kind: 'global' },
      fused_tool_id: toolId,
      layer_id: layerId,
      origin: 'tool_invoked',
    });
  }

  return (
    <div className="px-2.5 py-2">
      <button
        type="button"
        onClick={open}
        disabled={offline || !layerId}
        className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-1 disabled:opacity-40"
      >
        ↗ Open on canvas
      </button>
    </div>
  );
}
