import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { loadRegistry } from '@/lib/registry/loader';
import { resolveSpawnContext, spawnRegistryOp, spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { getAiAccess } from '@/lib/ai-access';
import type { ControlValue } from '@/types/widget';

/**
 * Baseline (aiAccess=false) command-palette launcher. Instead of spawning a
 * tool_invoked canvas widget, an op/preset row routes into the sidebar
 * inspector so all baseline editing happens there:
 *  - op row   → open + scroll to that op's Adjustments accordion section (no
 *               canonical write; the user then edits the sliders).
 *  - preset row → apply the preset's params to CANONICAL (so the look lands),
 *               open the touched sections, and scroll to the first.
 *
 * Both target the SAME (session, layer, scope) the widget path would have used
 * via {@link resolveSpawnContext} — so the manipulated variable stays the
 * presence of the widget layer, nothing else.
 */

/** Open the inspector on Adjustments, targeting `layerId`. */
function openAdjustmentsFor(layerId: string): void {
  const editor = useEditorStore.getState();
  if (editor.activeLayerId !== layerId) editor.setActiveLayer(layerId);
  usePreferencesStore.getState().showAdjustments();
}

/** Route an op row into the inspector: open + scroll to its section. */
export function routeOpToInspector(opId: string): void {
  const ctx = resolveSpawnContext();
  if (!ctx) return;
  openAdjustmentsFor(ctx.layerId);
  const editor = useEditorStore.getState();
  editor.expandSection(opId);
  editor.scrollToSection(opId);
}

/**
 * Dispatch an op row the way every op surface should: when the AI widget
 * layer is enabled (`aiAccess`) spawn a `tool_invoked` canvas widget;
 * otherwise route deterministically into the sidebar inspector. Shared by
 * Cmd+K (CommandPalette) and Image ▸ Adjustments (MenuBar) so both behave
 * identically in either study condition — before, the menu always spawned a
 * widget and did nothing in the baseline condition.
 */
export function dispatchOp(opId: string, label?: string): void {
  if (getAiAccess()) spawnRegistryOp(opId, label);
  else routeOpToInspector(opId);
}

/** Preset counterpart to {@link dispatchOp}. */
export function dispatchPreset(presetId: string, label?: string): void {
  if (getAiAccess()) spawnRegistryPreset(presetId, label);
  else routePresetToInspector(presetId);
}

/**
 * Params-carrying counterpart to {@link dispatchOp} for mechanical Auto
 * specs (Auto Light / Color / Tone / Contrast): with the AI widget layer on,
 * spawn a `tool_invoked` widget seeded with the computed params; in the
 * baseline condition apply the params straight to canonical and open the
 * op's inspector section — mirroring {@link routePresetToInspector}.
 */
export function dispatchOpWithParams(
  opId: string,
  intent: string,
  params: Record<string, number | string | boolean>,
): void {
  if (getAiAccess()) {
    spawnRegistryOp(opId, intent, params);
    return;
  }
  const ctx = resolveSpawnContext();
  if (!ctx) return;
  const reg = loadRegistry();
  const nodeType = reg.ops[opId]?.engine?.node_type;
  if (!nodeType) return;
  openAdjustmentsFor(ctx.layerId);
  for (const [param, value] of Object.entries(params)) {
    void backendTools.set_param(ctx.sid, {
      layerId: ctx.layerId,
      op: nodeType,
      param,
      value,
    });
  }
  const editor = useEditorStore.getState();
  editor.expandSection(opId);
  editor.scrollToSection(opId);
}

/** Route a preset row into the inspector: apply its params to canonical, open
 *  the touched sections, scroll to the first. */
export function routePresetToInspector(presetId: string): void {
  const ctx = resolveSpawnContext();
  if (!ctx) return;
  const reg = loadRegistry();
  const preset = reg.presets[presetId];
  if (!preset) return;
  openAdjustmentsFor(ctx.layerId);
  const editor = useEditorStore.getState();
  let firstSection: string | null = null;
  for (const p of preset.ops) {
    // `set_param`'s `op` is the engine node type (== ProcessingDefinition
    // adjustmentType), not the registry op id. Map op_id → engine.node_type.
    const nodeType = reg.ops[p.op_id]?.engine?.node_type;
    if (!nodeType) continue;
    for (const [param, value] of Object.entries(p.params)) {
      void backendTools.set_param(ctx.sid, {
        layerId: ctx.layerId,
        op: nodeType,
        param,
        value: value as ControlValue,
      });
    }
    editor.expandSection(p.op_id);
    if (!firstSection) firstSection = p.op_id;
  }
  if (firstSection) editor.scrollToSection(firstSection);
}
