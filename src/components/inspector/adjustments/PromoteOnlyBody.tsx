import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { promoteToCanvas } from './promote';

interface PromoteOnlyBodyProps {
  toolId: string;
}

export function PromoteOnlyBody({ toolId }: PromoteOnlyBodyProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const layerId = useEditorStore((s) => s.activeLayerId);

  return (
    <div className="px-2.5 py-2">
      <button
        type="button"
        onClick={() => promoteToCanvas(sessionId, toolId, layerId)}
        disabled={offline || !layerId}
        className="text-[10px] text-text-secondary hover:text-text-primary border border-border rounded px-2 py-1 disabled:opacity-40"
      >
        ↗ Open on canvas
      </button>
    </div>
  );
}
