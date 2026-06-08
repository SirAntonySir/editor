import { backendTools } from '@/lib/backend-tools';

/** Spawn a single-band HSL widget locked to `band` (e.g. 'blue' → `hsl_blue`).
 *  Mirrors promote.ts; no-op when offline / no active layer. */
export function promoteSingleBand(
  sessionId: string | null,
  band: string,
  layerId: string | null,
): void {
  if (!sessionId || !layerId) return;
  void backendTools.propose_widget(sessionId, {
    intent: `HSL ${band}`,
    scope: { kind: 'global' },
    op_id: `hsl_${band}`,
    layer_id: layerId,
    origin: 'tool_invoked',
  });
}
