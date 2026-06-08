import { backendTools } from '@/lib/backend-tools';

/** Spawn a single-band HSL widget locked to `band` (e.g. 'blue' → tone_blue preset).
 *  Migrated from propose_widget to proposeStack using the per-band tone preset.
 *  No-op when offline / no active layer. */
export function promoteSingleBand(
  sessionId: string | null,
  band: string,
  layerId: string | null,
): void {
  if (!sessionId || !layerId) return;
  void backendTools.proposeStack(sessionId, {
    intent: `HSL ${band}`,
    scope: { kind: 'global' },
    preset_id: `tone_${band}`,
    layer_id: layerId,
    origin: 'tool_invoked',
  });
}
