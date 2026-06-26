import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

/** The v1 curated tool set the agent loop exposes to the LLM (spec §3.F).
 *  propose_adjustment_widgets is dispatched server-side, so it is NOT a client
 *  manifest — it's added to the Anthropic tools list by the backend. */
export const AGENT_LOOP_TOOLS: string[] = [
  'get_image_context',
  'list_objects',
  'get_active_selection',
  'select_object',
  'extract_object_to_image_node',
  'convert_object_to_layer_mask',
];

/** Run an agentic palette turn. Serializes the curated client tools, attaches
 *  any object ids the user pinned as chips, and POSTs to the backend loop. */
export async function runAgentTurn(
  prompt: string,
  attachedObjects: string[],
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };
  // Seed the backend's node_layers with the active node's real layer ids so
  // propose_adjustment_widgets on the original node resolves (the loop threads
  // extracted nodes itself).
  const editor = useEditorStore.getState();
  const nodeId = editor.activeImageNodeId;
  const node = nodeId ? editor.imageNodes[nodeId] : undefined;
  const activeNode = node ? { image_node_id: nodeId as string, layer_ids: node.layerIds } : null;
  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: attachedObjects,
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNode,
  });
}
