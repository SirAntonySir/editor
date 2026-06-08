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

/** Material icon name per op id. */
const ICON_MAP: Record<string, string> = {
  light:         'light_mode',
  color:         'palette',
  kelvin:        'thermostat',
  sharpen:       'deblur',
  blur:          'blur_on',
  clarity:       'auto_awesome',
  grain:         'grain',
  splitTone:     'gradient',
  vignette:      'vignette',
  'time-of-day': 'wb_twilight',
};

/**
 * Build ProcessingDefinition objects for all registry ops that have a known
 * icon mapping and only scalar params (i.e. not curves/hsl/levels/filters).
 *
 * Ops NOT in ICON_MAP are skipped — they have bespoke Panel files:
 *   curves, hsl, levels, filters (registered separately in index.ts)
 * Compound ops (time-of-day) are included here; ToolSection dispatches them
 * to CompoundWidgetBody when a compound widget is active.
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
    const iconName = ICON_MAP[id];
    if (!iconName) continue; // bespoke or non-standard op — handled elsewhere

    const Icon = createMaterialIcon(iconName);

    // Build ParamDefinition array from registry op scalar params (in binding order).
    const params: ParamDefinition[] = op.bindings
      .filter((b) => op.params[b.param_key]?.type === 'scalar')
      .map((b) => {
        const p = op.params[b.param_key];
        const range = p.range as [number, number];
        return {
          key: b.param_key,
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
