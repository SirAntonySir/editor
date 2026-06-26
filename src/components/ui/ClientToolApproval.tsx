import { Check, X } from 'lucide-react';
import { useClientToolApproval } from '@/store/client-tool-approval-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { LlmToolRegistry } from '@/lib/tool-manifest/llm-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { useAiAccess } from '@/lib/ai-access';

/** Allow/deny chips for backend-requested mutate tools (the per-step approval
 *  gate). Mirrors SuggestionChips' dock slot. Hidden entirely in the study
 *  control condition (AI_access=false). */
export function ClientToolApproval() {
  const aiAccess = useAiAccess();
  const pending = useClientToolApproval((s) => s.pending);
  if (!aiAccess || pending.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1" role="region" aria-label="AI tool approvals">
      {pending.map((req) => (
        <div
          key={req.requestId}
          className="overlay flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-primary"
        >
          <span className="text-[var(--color-ai)]">{describeTool(req.name)}</span>
          <button
            type="button"
            aria-label="Allow"
            onClick={() => void resolveApproval(req.requestId, req.name, req.input, true)}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
          >
            <Check size={13} />
          </button>
          <button
            type="button"
            aria-label="Deny"
            onClick={() => void resolveApproval(req.requestId, req.name, req.input, false)}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:bg-surface-secondary"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Human-readable label for a tool request. Kept terse for the dock chip. */
function describeTool(name: string): string {
  if (name === 'extract_object_to_image_node') return 'Extract object to a new image node?';
  if (name === 'convert_object_to_layer_mask') return 'Convert object to a layer mask?';
  return `Run ${name}?`;
}

async function resolveApproval(
  requestId: string,
  name: string,
  input: Record<string, unknown>,
  allow: boolean,
): Promise<void> {
  const remove = useClientToolApproval.getState().remove;
  const sid = useBackendState.getState().sessionId;
  if (!sid) { remove(requestId); return; }
  if (!allow) {
    await backendTools.postToolResult(sid, { requestId, ok: false, denied: true });
    remove(requestId);
    return;
  }
  try {
    const output = await LlmToolRegistry.invoke(name, input);
    await backendTools.postToolResult(sid, { requestId, ok: true, output });
  } catch (err) {
    await backendTools.postToolResult(sid, {
      requestId, ok: false, error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    remove(requestId);
  }
}
