import { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store';
import { LutRegistry } from '@/lib/lut-registry';
import { PRESET_LUTS, type LUTData } from '@/lib/lut-parser';

/**
 * Compact dropdown LUT selector for inline filter nodes.
 */
export function InlineFilterSelector({ layerId }: { layerId: string }) {
  const activeLutName = useEditorStore((s) => {
    const layer = s.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    const lutAdj = layer.adjustmentStack.adjustments.find((a) => a.type === 'lut');
    return lutAdj?.name ?? null;
  });

  const lutNames = useMemo(() => PRESET_LUTS.map((gen) => gen().title), []);

  const applyFilter = useCallback(
    (name: string) => {
      const store = useEditorStore.getState();
      const layer = store.layers.find((l) => l.id === layerId);
      if (!layer) return;

      // Remove existing LUT
      const existingLut = layer.adjustmentStack.adjustments.find((a) => a.type === 'lut');
      if (existingLut) {
        LutRegistry.remove(existingLut.id);
        store.removeAdjustment(layerId, existingLut.id);
      }

      // Find and apply the selected LUT
      for (const genLUT of PRESET_LUTS) {
        const lut: LUTData = genLUT();
        if (lut.title !== name) continue;

        const adjustmentId = crypto.randomUUID();
        LutRegistry.register(adjustmentId, lut.size, lut.data);
        store.addAdjustment(layerId, {
          id: adjustmentId,
          type: 'lut',
          name: lut.title,
          enabled: true,
          blendMode: 'normal',
          opacity: 1,
          params: { lutSize: lut.size },
        });
        break;
      }
    },
    [layerId],
  );

  return (
    <div className="px-3 py-2 nodrag nowheel">
      <select
        value={activeLutName ?? ''}
        onChange={(e) => {
          e.stopPropagation();
          if (e.target.value) applyFilter(e.target.value);
        }}
        className="w-full text-[10px] bg-surface-secondary border border-separator rounded px-1.5 py-1 text-text-primary outline-none focus:border-accent cursor-pointer"
      >
        <option value="">None</option>
        {lutNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
