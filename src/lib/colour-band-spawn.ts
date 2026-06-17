import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { scopeFromSelection } from '@/lib/scope-from-selection';

function activeNodeLayerIds(): string[] | undefined {
  const editor = useEditorStore.getState();
  const id = editor.activeImageNodeId;
  if (!id) return undefined;
  return editor.imageNodes[id]?.layerIds;
}

/** Spawn a single-band HSL widget locked to `band` (e.g. 'blue' → tone_blue preset).
 *  Migrated from propose_widget to proposeStack using the per-band tone preset.
 *  No-op when offline / no active layer. */
export function promoteSingleBand(
  sessionId: string | null,
  band: string,
  layerId: string | null,
): void {
  if (!sessionId || !layerId) return;
  const scope = scopeFromSelection(useEditorStore.getState().activeObjectId);
  const layerIds = activeNodeLayerIds();
  void backendTools.proposeStack(sessionId, {
    intent: `HSL ${band}`,
    scope,
    preset_id: `tone_${band}`,
    layerId,
    ...(layerIds ? { layerIds } : {}),
    origin: 'tool_invoked',
  });
}
