/**
 * Generates ProcessingDefinition objects from the SSoT registry ops.
 *
 * For these ops, the Inspector rendering is handled by ToolSection's
 * type-dispatch → RegistryDrivenSectionBody → RegistryDrivenPanel.
 * No bespoke Panel component is needed.
 *
 * Icon mapping: each op id maps to a Material Icon name via ICON_MAP.
 */
import { createMaterialIcon } from '@/components/ui/MaterialIcon';
import { loadRegistry } from '@/lib/registry/loader';
import type { ProcessingDefinition, ParamDefinition } from '@/types/processing';

/** Ops with bespoke Inspector panels — registered separately in
 *  `src/processing/index.ts`. They participate in the WebGL pipeline but
 *  don't use the registry-driven section body. */
const BESPOKE_PANEL_OPS = new Set(['curves', 'hsl', 'levels', 'filters']);

/**
 * Build ProcessingDefinition objects for all registry ops EXCEPT those with
 * bespoke panel files. The icon is read from each op's `icon` field
 * (Material icon name); ops without one fall back to `tune`.
 * Compound ops (time-of-day) are included; ToolSection dispatches them to
 * CompoundWidgetBody when a compound widget is active.
 */
export function buildRegistryProcessingDefs(): ProcessingDefinition[] {
  const reg = loadRegistry();
  const defs: ProcessingDefinition[] = [];

  // Sort by render_order so registration order is deterministic and matches
  // the pipeline order (e.g. light before color, both adjustmentType 'basic').
  const sortedOps = Object.entries(reg.ops).sort(
    ([, a], [, b]) => a.engine.render_order - b.engine.render_order,
  );

  for (const [id, op] of sortedOps) {
    if (BESPOKE_PANEL_OPS.has(id)) continue; // handled by curves.tsx / hsl.tsx / etc.

    const Icon = createMaterialIcon(op.icon ?? 'tune');

    // Build ParamDefinition array from registry op scalar params (in binding order).
    const params: ParamDefinition[] = op.bindings
      .filter((b) => op.params[b.paramKey]?.type === 'scalar')
      .map((b) => {
        const p = op.params[b.paramKey];
        const range = p.range as [number, number];
        return {
          key: b.paramKey,
          label: b.label,
          min: range[0],
          max: range[1],
          default: p.default as number,
          ...(p.step !== undefined ? { step: p.step } : {}),
        };
      });

    defs.push({
      id,
      label: op.display_name,
      icon: Icon,
      category: 'adjust',
      adjustmentType: op.engine.node_type,
      paramKeys: params.map((p) => p.key),
      params,
      // No Panel: ToolSection dispatches to RegistryDrivenSectionBody for these ops.
    });
  }

  return defs;
}
