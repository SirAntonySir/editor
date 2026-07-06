import { ArrowUpRight } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { promoteToCanvas } from './promote';
import { useAiAccess } from '@/lib/ai-access';

interface PromoteOnlyBodyProps {
  toolId: string;
}

export function PromoteOnlyBody({ toolId }: PromoteOnlyBodyProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const layerId = useEditorStore((s) => s.activeLayerId);
  const aiAccess = useAiAccess();

  // "Open on canvas" is the AI widget layer — gated off in the study baseline.
  if (!aiAccess) return null;

  return (
    <div className="px-2.5 py-2">
      <button
        type="button"
        onClick={() => promoteToCanvas(sessionId, toolId, layerId)}
        disabled={offline || !layerId}
        className="inline-flex items-center gap-1 text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-1 hover:bg-surface-secondary disabled:opacity-40"
      >
        <ArrowUpRight size={11} aria-hidden /> Open on canvas
      </button>
    </div>
  );
}
