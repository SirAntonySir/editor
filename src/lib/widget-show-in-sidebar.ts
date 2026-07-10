import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { loadRegistry } from '@/lib/registry/loader';
import { widgetTargetLayerIds } from '@/lib/widget-targets';
import type { Widget } from '@/types/widget';

/**
 * True when a widget maps to a tool section in the Adjustments sidebar — i.e.
 * its `opId` is a registry op (light, color, curves, hsl, …). Preset, genfill,
 * and compound widgets carry no single-op id, so they have no section to jump
 * to and the "Show in sidebar" affordance is hidden for them.
 */
export function widgetHasSidebarSection(widget: Widget): boolean {
  return !!widget.opId && !!loadRegistry().ops[widget.opId];
}

/**
 * Reveal a widget's tool in the Adjustments sidebar: open the sidebar on the
 * Adjustments tab, scope it to the widget's target layer, then expand + scroll
 * the matching tool section into view. Reuses the `sectionScrollTarget` path the
 * baseline command-palette launcher already drives (AdjustmentsAccordion picks
 * it up and scrolls `[data-section-id="<opId>"]`).
 *
 * No-op on the section scroll when the widget has no op section; the sidebar
 * still opens so the click is never dead.
 */
export function showWidgetInSidebar(widget: Widget): void {
  usePreferencesStore.getState().showAdjustments();

  const targetLayerId = widgetTargetLayerIds(widget)[0];
  const editor = useEditorStore.getState();
  if (targetLayerId) editor.setActiveLayer(targetLayerId);

  if (!widgetHasSidebarSection(widget) || !widget.opId) return;
  editor.expandSection(widget.opId);
  editor.scrollToSection(widget.opId);
}
