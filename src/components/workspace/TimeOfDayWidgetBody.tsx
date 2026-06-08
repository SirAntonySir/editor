import { useCallback } from 'react';
import type { Widget } from '@/types/widget';
import { PerceptualDialBody } from './PerceptualDialBody';
import { CompiledReadout } from '@/components/ui/CompiledReadout';
import { useProcessingParam } from '@/lib/use-processing-param';
import { interpolate1D } from '@/lib/perceptual-dial/interpolate';
import { TIME_OF_DAY_ANCHORS } from '@/processing/anchors/time-of-day-anchors';
import { useBackendState } from '@/store/backend-state-slice';

interface TimeOfDayWidgetBodyProps {
  widget: Widget;
}

export function TimeOfDayWidgetBody({ widget }: TimeOfDayWidgetBodyProps) {
  const layerId = widget.nodes[0]?.layer_id ?? '';
  const [position, setPosition] = useProcessingParam(
    layerId, 'compound', widget.id, 'time_of_day.position', 0.30,
  );

  const sessionId = useBackendState((s) => s.sessionId);

  const handleChange = useCallback((t: number) => {
    setPosition(t);
    // Interpolate the compound bundle and patch the canonical compound node
    // optimistically so the renderer sees live values mid-drag.
    //
    // Key is the canonical node id `canon:<layer>:compound` — matches what
    // `image-node-renderer` uses for its compound-node merge step. Includes
    // `time_of_day.position` so the snapshot stays internally consistent
    // when the patch lands.
    const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, t);
    const snapshot = useBackendState.getState().snapshot;
    if (!snapshot || !sessionId) return;
    const baseRevision = snapshot.revision;
    const bindings = [
      { paramKey: 'time_of_day.position', value: t },
      ...Object.entries(compiled).map(([paramKey, value]) => ({ paramKey, value })),
    ];
    useBackendState.getState().applyOptimistic(
      `canon:${layerId}:compound`,
      { bindings, baseRevision },
    );
  }, [setPosition, sessionId, layerId]);

  const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, position);
  const entries = compiledToReadoutEntries(compiled);

  return (
    <div className="flex flex-col gap-2">
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={position}
        onPositionChange={handleChange}
      />
      <div className="px-2 pb-2">
        <CompiledReadout entries={entries} topN={entries.length} />
      </div>
    </div>
  );
}

/** Map compiled `${op}.${param}` keys to display labels and units. */
function compiledToReadoutEntries(compiled: Record<string, number>) {
  return Object.entries(compiled).map(([key, value]) => ({
    label: prettyLabel(key),
    value,
    unit: key === 'kelvin.kelvin' ? 'K' : undefined,
  }));
}

function prettyLabel(key: string): string {
  const map: Record<string, string> = {
    'kelvin.kelvin':     'WB',
    'light.exposure':    'Exposure',
    'light.contrast':    'Contrast',
    'light.highlights':  'Highlights',
    'light.shadows':     'Shadows',
    'color.vibrance':    'Vibrance',
    'hsl.orange_sat':    'Orange Sat',
    'hsl.blue_sat':      'Blue Sat',
    'filters.vignette_amount': 'Vignette',
  };
  return map[key] ?? key;
}
