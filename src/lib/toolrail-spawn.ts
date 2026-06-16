// Toolrail tool click handler.
//
// Workspace canvas: the toolrail click routes through `proposeStack` with
// `forced_ops: [processingId]`, which bypasses the LLM and uses registry
// defaults (origin: tool_invoked). A widget can only be spawned when the user
// has an active ImageNode selected (T13 gate).

import { backendTools } from '@/lib/backend-tools';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { toast } from '@/components/ui/Toast';
import { scopeFromSelection } from '@/lib/scope-from-selection';
import type { Scope } from '@/types/scope';

/**
 * Handle a toolrail click for a tool with a `processingId`.
 *
 * Returns `true` when the click was handled (a `proposeStack` was kicked
 * off, the click was gated out, or there's no backend session) and `false`
 * when the tool isn't backed by a processing definition.
 */
export function spawnToolWidget(toolName: string): boolean {
  const tool = CanvasToolRegistry.get(toolName);
  if (!tool?.processingId) return false;

  const ctx = _resolveSpawnContext();
  if (!ctx) return true;

  void backendTools.proposeStack(ctx.sid, {
    intent: tool.label ?? tool.processingId,
    scope: ctx.scope,
    forced_ops: [tool.processingId],
    layerId: ctx.layerId,
    origin: 'tool_invoked',
  });
  return true;
}

/**
 * Resolve session + active image node + layer for a Cmd+K spawn.
 * Returns null when the click should be gated out (user is shown a toast).
 */
function _resolveSpawnContext(): {
  sid: string;
  layerId: string;
  scope: Scope;
} | null {
  const editor = useEditorStore.getState();
  const activeImageNodeId = editor.activeImageNodeId;
  if (!activeImageNodeId) {
    toast.info('Select an image first.');
    return null;
  }
  const sid = useBackendState.getState().sessionId;
  if (!sid) return null;
  const node = editor.imageNodes[activeImageNodeId];
  if (!node) return null;
  const layerId =
    editor.activeLayerId && node.layerIds.includes(editor.activeLayerId)
      ? editor.activeLayerId
      : node.layerIds[0];
  if (!layerId) return null;
  return { sid, layerId, scope: scopeFromSelection(editor.activeObjectId) };
}

/** Spawn a single-op widget by registry op id. Used by Cmd+K when the user
 *  picks an Adjustments row. Bypasses the LLM (origin: tool_invoked) and
 *  uses registry defaults via the backend's forced_ops fast-path.
 *
 *  Optional `params` overrides individual op-param starting values — the
 *  auto-tune flow uses this to spawn a pre-configured widget. Keys absent
 *  from the op's schema are silently dropped by the backend. */
export function spawnRegistryOp(
  opId: string,
  intent?: string,
  params?: Record<string, number | string | boolean>,
): void {
  const ctx = _resolveSpawnContext();
  if (!ctx) return;
  void backendTools.proposeStack(ctx.sid, {
    intent: intent ?? opId,
    scope: ctx.scope,
    forced_ops: [opId],
    forced_params: params ? { [opId]: params } : undefined,
    layerId: ctx.layerId,
    origin: 'tool_invoked',
  });
}

/** Spawn a preset's full widget stack by preset id. Routes through
 *  `proposeStack({preset_id})` so the backend unfolds preset.ops into one
 *  widget per op with the preset's baked-in param values. */
export function spawnRegistryPreset(presetId: string, intent?: string): void {
  const ctx = _resolveSpawnContext();
  if (!ctx) return;
  void backendTools.proposeStack(ctx.sid, {
    intent: intent ?? presetId,
    scope: ctx.scope,
    preset_id: presetId,
    layerId: ctx.layerId,
    origin: 'tool_invoked',
  });
}
