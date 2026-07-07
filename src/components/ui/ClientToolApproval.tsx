import { Check, X, Image as ImageIcon, Layers } from 'lucide-react';
import { useClientToolApproval } from '@/store/client-tool-approval-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { LlmToolRegistry } from '@/lib/tool-manifest/llm-tool-registry';
import { backendTools } from '@/lib/backend-tools';
import { useAiAccess } from '@/lib/ai-access';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { copyObjectToLayer } from '@/lib/segmentation/object-actions';

const EXTRACT_TOOL = 'copy_object_to_image_node';

/** Allow/deny chips for backend-requested mutate tools (the per-step approval
 *  gate). Mirrors SuggestionChips' dock slot. Hidden entirely in the study
 *  control condition (AI_access=false). The extract tool gets a 3-way choice
 *  (new image node / new layer / deny) instead of plain Allow/Deny. */
export function ClientToolApproval() {
  const aiAccess = useAiAccess();
  const pending = useClientToolApproval((s) => s.pending);
  if (!aiAccess || pending.length === 0) return null;

  return (
    <div className="flex flex-col items-center gap-1" role="region" aria-label="AI tool approvals">
      {pending.map((req) =>
        req.name === EXTRACT_TOOL ? (
          <div
            key={req.requestId}
            className="overlay pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-primary"
          >
            <span className="text-[var(--color-ai)]">Copy object</span>
            <button
              type="button"
              aria-label="Copy to image node"
              title="New image node"
              onClick={() => void resolveExtract(req.requestId, req.input, 'node')}
              className="flex items-center gap-1 h-5 px-1.5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
            >
              <ImageIcon size={12} />
              <span>Node</span>
            </button>
            <button
              type="button"
              aria-label="Copy to new layer"
              title="New layer"
              onClick={() => void resolveExtract(req.requestId, req.input, 'layer')}
              className="flex items-center gap-1 h-5 px-1.5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
            >
              <Layers size={12} />
              <span>Layer</span>
            </button>
            <button
              type="button"
              aria-label="Deny"
              onClick={() => void resolveExtract(req.requestId, req.input, 'deny')}
              className="flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:bg-surface-secondary"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div
            key={req.requestId}
            className="overlay pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-primary"
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
        ),
      )}
    </div>
  );
}

/** Human-readable label for a tool approval. Phrased as "Allow to …" so the
 *  chip reads as a permission grant rather than a raw tool name. */
function describeTool(name: string): string {
  if (name === 'select_object') return 'Allow to select object';
  // Fallback: humanise the snake_case tool name → "Allow to select object".
  return `Allow to ${name.replace(/_/g, ' ')}`;
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

/** Resolve the extract approval with a node/layer/deny choice. `node` runs the
 *  manifest handler (extract to a new image node); `layer` runs
 *  `copyObjectToLayer` and returns the SAME `{ image_node_id, layer_ids }`
 *  contract (image node = the source node, layer = the new layer) so the agent
 *  loop continues unchanged; `deny` reports a denial. */
async function resolveExtract(
  requestId: string,
  input: Record<string, unknown>,
  choice: 'node' | 'layer' | 'deny',
): Promise<void> {
  const remove = useClientToolApproval.getState().remove;
  const sid = useBackendState.getState().sessionId;
  if (!sid) { remove(requestId); return; }
  if (choice === 'deny') {
    await backendTools.postToolResult(sid, { requestId, ok: false, denied: true });
    remove(requestId);
    return;
  }
  try {
    if (choice === 'node') {
      const output = await LlmToolRegistry.invoke(EXTRACT_TOOL, input);
      await backendTools.postToolResult(sid, { requestId, ok: true, output });
    } else {
      const maskId = String(input.maskId ?? '');
      const editor = useEditorStore.getState();
      const sourceNode =
        (typeof input.imageNodeId === 'string' ? input.imageNodeId : undefined)
        ?? objectOwnership.get(maskId)
        ?? editor.activeImageNodeId
        ?? undefined;
      if (!sourceNode) throw new Error('Could not resolve a source image node for the layer.');
      const layerId = copyObjectToLayer(maskId, sourceNode);
      if (!layerId) throw new Error('Extract to layer failed.');
      await backendTools.postToolResult(sid, {
        requestId,
        ok: true,
        output: { ok: true, image_node_id: sourceNode, layer_ids: [layerId] },
      });
    }
  } catch (err) {
    await backendTools.postToolResult(sid, {
      requestId, ok: false, error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    remove(requestId);
  }
}
