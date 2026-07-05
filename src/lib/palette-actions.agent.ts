import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { extractObjectToImageNode, extractObjectToLayer } from '@/lib/segmentation/object-actions';
import { planForcedExtractions } from '@/lib/segmentation/forced-extraction';
import { segmentRegionFromPoint } from '@/lib/segmentation/segment-region';
import { extractObjectIds, parseTargetSourceId } from '@/lib/prompt-doc';
import { useRegionExtractionApproval, type ExtractChoice } from '@/store/region-extraction-approval';
import type { CandidateRegion } from '@/types/image-context';

type ForcedTarget = { image_node_id: string; layer_ids: string[] };

/** Asks the user, per attached region, whether to extract to a new image node,
 *  a new layer, or skip it. Defaults to the dock approval store; tests inject. */
type RegionChoiceFn = (label: string) => Promise<ExtractChoice>;

/**
 * Resolve attached region chips into forced targets, asking the user per region
 * (node / layer / deny) BEFORE anything is segmented or extracted. This is the
 * approval gate for the deterministic pre-extraction path: a `deny` drops the
 * region entirely (and a maskless region is never segmented); `node` bakes a new
 * image node; `layer` bakes a new layer on the source node. Failures fall back
 * to `attached_objects` so the agent can still try.
 */
async function resolveAttachedRegions(
  regionSourceIds: string[],
  candidateRegions: ReadonlyArray<CandidateRegion>,
  activeNodeId: string | null,
  getChoice: RegionChoiceFn,
): Promise<{ forcedTargets: ForcedTarget[]; fallbackIds: string[] }> {
  const plan = planForcedExtractions(regionSourceIds, candidateRegions, (id) => maskStore.has(id));
  const forcedTargets: ForcedTarget[] = [];
  const fallbackIds = [...plan.fallbackIds];

  // Apply an already-segmented mask onto `ownerNode` per the user's choice.
  const applyExtraction = (maskId: string, ownerNode: string | undefined, choice: ExtractChoice): void => {
    if (choice === 'deny') return; // user rejected this selection — drop it
    if (!ownerNode) { fallbackIds.push(maskId); return; }
    if (choice === 'layer') {
      const layerId = extractObjectToLayer(maskId, ownerNode);
      if (layerId) forcedTargets.push({ image_node_id: ownerNode, layer_ids: [layerId] });
      else fallbackIds.push(maskId);
    } else {
      const extracted = extractObjectToImageNode(maskId, ownerNode);
      if (extracted) forcedTargets.push({ image_node_id: extracted.imageNodeId, layer_ids: [extracted.layerId] });
      else fallbackIds.push(maskId);
    }
  };

  // 1. Committed-mask regions: ask, then extract per choice.
  for (const { maskId } of plan.extractable) {
    const owner = objectOwnership.get(maskId) ?? activeNodeId ?? undefined;
    const label = maskStore.get(maskId)?.label ?? 'region';
    applyExtraction(maskId, owner, await getChoice(label));
  }

  // 2. Maskless AI regions with a click point: ask first, segment client-side
  //    (MobileSAM) only on a non-deny choice, then extract.
  for (const seg of plan.segmentable) {
    const choice = await getChoice(seg.label);
    if (choice === 'deny') continue;
    if (!activeNodeId) {
      fallbackIds.push(...extractObjectIds([{ sourceId: seg.sourceId }]));
      continue;
    }
    const maskId = await segmentRegionFromPoint(activeNodeId, seg.point, seg.label);
    if (maskId) applyExtraction(maskId, activeNodeId, choice);
    else fallbackIds.push(...extractObjectIds([{ sourceId: seg.sourceId }]));
  }

  return { forcedTargets, fallbackIds };
}

/** Collapse forced targets to one entry per image node, unioning their layer
 *  ids — so an image-node chip plus one of its layer chips don't double-target
 *  the same node. First-seen node order is preserved. */
function dedupeForcedTargets(targets: ForcedTarget[]): ForcedTarget[] {
  const byNode = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const t of targets) {
    let set = byNode.get(t.image_node_id);
    if (!set) {
      set = new Set();
      byNode.set(t.image_node_id, set);
      order.push(t.image_node_id);
    }
    for (const lid of t.layer_ids) set.add(lid);
  }
  return order.map((id) => ({ image_node_id: id, layer_ids: [...byNode.get(id)!] }));
}

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
  getChoice: RegionChoiceFn = (label) => useRegionExtractionApproval.getState().request(label),
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };

  const editor = useEditorStore.getState();
  const activeNodeId = editor.activeImageNodeId;
  const activeNode = activeNodeId ? editor.imageNodes[activeNodeId] : undefined;
  const candidateRegions = useAiSession.getState().context?.candidateRegions ?? [];

  // Split chips: regions go through the (approval-gated) extract/segment path;
  // explicit `@`-picked targets (image nodes / layers) become forced_targets
  // directly without a prompt — the user picked them explicitly.
  const regionSourceIds: string[] = [];
  const targetSourceIds: string[] = [];
  for (const sid of chipSourceIds) {
    (parseTargetSourceId(sid) ? targetSourceIds : regionSourceIds).push(sid);
  }

  // Ask the user per attached region (node / layer / deny), then extract.
  const { forcedTargets: regionTargets, fallbackIds } = await resolveAttachedRegions(
    regionSourceIds,
    candidateRegions,
    activeNodeId,
    getChoice,
  );
  const forcedTargets: ForcedTarget[] = [...regionTargets];

  // Explicit targets from the `@` picker. A node chip targets all its layers; a
  // layer chip resolves to its owning node + that single layer. Unresolvable
  // ids (image/layer deleted before submit) are dropped silently.
  for (const sid of targetSourceIds) {
    const ref = parseTargetSourceId(sid);
    if (!ref) continue;
    if (ref.kind === 'node') {
      const node = editor.imageNodes[ref.id];
      if (node) forcedTargets.push({ image_node_id: ref.id, layer_ids: node.layerIds });
    } else {
      const ownerId = Object.keys(editor.imageNodes).find((nid) =>
        editor.imageNodes[nid].layerIds.includes(ref.id),
      );
      if (ownerId) forcedTargets.push({ image_node_id: ownerId, layer_ids: [ref.id] });
    }
  }

  const activeNodePayload =
    activeNodeId && activeNode
      ? { image_node_id: activeNodeId, layer_ids: activeNode.layerIds }
      : null;

  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: fallbackIds,
    forced_targets: dedupeForcedTargets(forcedTargets),
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNodePayload,
  });
}

/** Accept-time mirror of {@link runAgentTurn} for a single autonomous region.
 *  Feeds one `region:ai:<label>` chip through the same approval-gated extract
 *  path (Extract → Node / Layer / ✕), then re-plans adjustments on the extracted
 *  node. `extracted` is false when the user denies, the region can't be resolved,
 *  or extraction fails — the caller then does a plain in-place accept instead of
 *  running an agent turn against the whole node. */
export async function runAgentTurnForRegion(
  intent: string,
  label: string,
  getChoice: RegionChoiceFn = (l) => useRegionExtractionApproval.getState().request(l),
): Promise<{ extracted: boolean; ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { extracted: false, ok: false, toolCalls: 0 };

  const editor = useEditorStore.getState();
  const activeNodeId = editor.activeImageNodeId;
  const activeNode = activeNodeId ? editor.imageNodes[activeNodeId] : undefined;
  const candidateRegions = useAiSession.getState().context?.candidateRegions ?? [];

  const { forcedTargets, fallbackIds } = await resolveAttachedRegions(
    [`region:ai:${label}`],
    candidateRegions,
    activeNodeId,
    getChoice,
  );

  // Nothing was baked into a node (deny / unresolved / extraction failure) —
  // signal the caller to fall back to a plain in-place accept.
  if (forcedTargets.length === 0) return { extracted: false, ok: true, toolCalls: 0 };

  const activeNodePayload =
    activeNodeId && activeNode
      ? { image_node_id: activeNodeId, layer_ids: activeNode.layerIds }
      : null;

  const res = await backendTools.agentTurn(sid, {
    intent,
    attached_objects: fallbackIds,
    forced_targets: dedupeForcedTargets(forcedTargets),
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNodePayload,
  });
  return { extracted: true, ...res };
}
