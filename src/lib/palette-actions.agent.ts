import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { extractObjectToImageNode } from '@/lib/segmentation/object-actions';
import { planForcedExtractions } from '@/lib/segmentation/forced-extraction';
import { segmentRegionFromPoint } from '@/lib/segmentation/segment-region';
import { extractObjectIds } from '@/lib/prompt-doc';

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

/** Run an agentic palette turn. Deterministically extracts each attached region
 *  chip into its own image node BEFORE the LLM loop, then tells the loop those
 *  nodes are its targets (see forced_targets in the backend system prompt).
 *  Chips with no backing mask fall back to `attached_objects` so the agent can
 *  still try to act on them. */
export async function runAgentTurn(
  prompt: string,
  chipSourceIds: string[],
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };

  const editor = useEditorStore.getState();
  const activeNodeId = editor.activeImageNodeId;
  const activeNode = activeNodeId ? editor.imageNodes[activeNodeId] : undefined;
  const candidateRegions = useAiSession.getState().context?.candidateRegions ?? [];

  const plan = planForcedExtractions(chipSourceIds, candidateRegions, (id) => maskStore.has(id));

  const forcedTargets: { image_node_id: string; layer_ids: string[] }[] = [];
  const fallbackIds = [...plan.fallbackIds];

  const pushExtraction = (maskId: string, sourceNodeId: string | undefined): void => {
    const extracted = sourceNodeId ? extractObjectToImageNode(maskId, sourceNodeId) : null;
    if (extracted) {
      forcedTargets.push({ image_node_id: extracted.imageNodeId, layer_ids: [extracted.layerId] });
    } else {
      fallbackIds.push(maskId); // extraction failed → let the agent try
    }
  };

  // 1. Regions that already have a mask: extract straight away.
  for (const { maskId } of plan.extractable) {
    pushExtraction(maskId, objectOwnership.get(maskId) ?? activeNodeId ?? undefined);
  }

  // 2. Maskless AI regions with a click point: segment client-side (MobileSAM)
  //    first — this is the Render path, where masks aren't precomputed — then
  //    extract. If segmentation fails, fall back so the agent can still try.
  for (const seg of plan.segmentable) {
    if (!activeNodeId) {
      fallbackIds.push(...extractObjectIds([{ sourceId: seg.sourceId }]));
      continue;
    }
    const maskId = await segmentRegionFromPoint(activeNodeId, seg.point, seg.label);
    if (maskId) {
      pushExtraction(maskId, activeNodeId);
    } else {
      fallbackIds.push(...extractObjectIds([{ sourceId: seg.sourceId }]));
    }
  }

  const activeNodePayload =
    activeNodeId && activeNode
      ? { image_node_id: activeNodeId, layer_ids: activeNode.layerIds }
      : null;

  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: fallbackIds,
    forced_targets: forcedTargets,
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNodePayload,
  });
}
