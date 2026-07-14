import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import type { LayerAdjustmentEntry } from '@/hooks/useLayerAdjustments';
import type { ControlValue, Widget } from '@/types/widget';

/** Backend half of the Layers-tab ⋯ menus. Every mutation goes through the
 *  same set_param / update_widget_targets tools the rest of the app uses —
 *  canonical stays the single source of truth. */

function writeParams(
  entry: LayerAdjustmentEntry,
  layerId: string,
  pick: (p: { value: ControlValue; resetValue: ControlValue }) => ControlValue,
): void {
  const backend = useBackendState.getState();
  const sessionId = backend.sessionId;
  if (!sessionId || !entry.op || !entry.touchedParams?.length) return;
  const baseRevision = backend.snapshot?.revision ?? 0;
  backend.applyOptimistic(`canon:${layerId}:${entry.op}`, {
    bindings: entry.touchedParams.map((p) => ({ paramKey: p.key, value: pick(p) })),
    baseRevision,
  });
  for (const p of entry.touchedParams) {
    void backendTools.set_param(sessionId, {
      layerId, op: entry.op, param: p.key, value: pick(p),
    });
  }
}

/** Copy every touched param of a canonical entry onto `toLayerId`. */
export function copyCanonicalToLayer(entry: LayerAdjustmentEntry, toLayerId: string): void {
  writeParams(entry, toLayerId, (p) => p.value);
}

/** Move = copy to the target, then reset each param on the source layer. */
export function moveCanonicalToLayer(
  entry: LayerAdjustmentEntry,
  fromLayerId: string,
  toLayerId: string,
): void {
  copyCanonicalToLayer(entry, toLayerId);
  writeParams(entry, fromLayerId, (p) => p.resetValue);
}

/** Reset the entry's touched params on `layerId` (the menu's destructive row). */
export function resetCanonicalOnLayer(entry: LayerAdjustmentEntry, layerId: string): void {
  writeParams(entry, layerId, (p) => p.resetValue);
}

/** Check/uncheck a layer in a widget's "Applies to" set. */
export function setWidgetTargetChecked(widget: Widget, layerId: string, checked: boolean): void {
  const sessionId = useBackendState.getState().sessionId;
  if (!sessionId) return;
  void backendTools.update_widget_targets(sessionId, {
    widgetId: widget.id,
    op: checked ? 'add' : 'remove',
    layerId,
  });
}

/** "Edit in Adjustments ↗": activate the layer, switch the inspector to the
 *  Adjustments tab, expand + scroll to the op's section. */
export function editCanonicalInAdjustments(layerId: string, defId: string): void {
  const editor = useEditorStore.getState();
  if (editor.activeLayerId !== layerId) editor.setActiveLayer(layerId);
  usePreferencesStore.getState().showAdjustments();
  editor.expandSection(defId);
  editor.scrollToSection(defId);
}
