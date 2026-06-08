import { useCallback, useMemo, useRef } from 'react';
import type { Widget, ControlBinding } from '@/types/widget';
import { PerceptualDialBody } from './PerceptualDialBody';
import { EditableParamCard } from '@/components/ui/EditableParamCard';
import { useProcessingParam } from '@/lib/use-processing-param';
import { interpolate1D } from '@/lib/perceptual-dial/interpolate';
import type { Anchor } from '@/lib/perceptual-dial/types';
import { loadRegistry } from '@/lib/registry/loader';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

/** Read TOD anchors from the SSoT registry and shape them into the legacy
 *  PerceptualDialBody `Anchor` form. Source of truth: shared/registry/ops/time-of-day.json. */
function loadTodAnchors(): Anchor[] {
  const op = loadRegistry().ops['time-of-day'];
  if (!op?.compound) return [];
  return op.compound.anchors.map((a) => ({
    id: a.name,
    label: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    position: [a.position],
    params: a.values,
  }));
}
const TIME_OF_DAY_ANCHORS: Anchor[] = loadTodAnchors();

interface TimeOfDayWidgetBodyProps {
  widget: Widget;
}

/** Stable order — matches the anchor table's key order so cards don't shuffle. */
const BUNDLE_KEYS = [
  'kelvin.kelvin',
  'light.exposure',
  'light.contrast',
  'light.highlights',
  'light.shadows',
  'color.vibrance',
  'hsl.orange_sat',
  'hsl.blue_sat',
  'filters.vignette_amount',
] as const;

const LABELS: Record<string, string> = {
  'kelvin.kelvin':           'WB',
  'light.exposure':          'Exposure',
  'light.contrast':          'Contrast',
  'light.highlights':        'Highlights',
  'light.shadows':           'Shadows',
  'color.vibrance':          'Vibrance',
  'hsl.orange_sat':          'Orange Sat',
  'hsl.blue_sat':            'Blue Sat',
  'filters.vignette_amount': 'Vignette',
};

const UNITS: Record<string, string | undefined> = {
  'kelvin.kelvin': 'K',
};

const DEBOUNCE_MS = 300;

export function TimeOfDayWidgetBody({ widget }: TimeOfDayWidgetBodyProps) {
  const layerId = widget.nodes[0]?.layer_id ?? '';
  const [position, setPosition] = useProcessingParam(
    layerId, 'compound', widget.id, 'time_of_day.position', 0.30,
  );

  const sessionId = useBackendState((s) => s.sessionId);

  // Live values for the cards: prefer the optimistic compound patch (set by
  // the dial drag), fall back to widget bindings, fall back to interpolation.
  // Subscribed via primitive selectors so re-renders fire on every drag tick.
  const optimisticBundle = useBackendState((s) => s.optimistic.get(`canon:${layerId}:compound`));
  const lockedSet = useMemo(
    () => new Set(widget.locked_params ?? []),
    [widget.locked_params],
  );
  const bindingByKey = useMemo(() => {
    const m = new Map<string, ControlBinding>();
    for (const b of widget.bindings) m.set(b.param_key, b);
    return m;
  }, [widget.bindings]);

  const interpolated = useMemo(() => interpolate1D(TIME_OF_DAY_ANCHORS, position), [position]);

  function readValue(key: string): number {
    if (optimisticBundle) {
      const opt = optimisticBundle.bindings.find((b) => b.paramKey === key);
      if (opt !== undefined && typeof opt.value === 'number') return opt.value;
    }
    const binding = bindingByKey.get(key);
    if (binding && typeof binding.value === 'number') return binding.value;
    return interpolated[key] ?? 0;
  }

  // Dial drag: optimistic patch on the compound node (renderer reads this
  // via the canon-keyed merge), then debounced `set_widget_param` to backend.
  // Backend recomputes the bundle and writes non-locked keys back.
  const handleChange = useCallback((t: number) => {
    setPosition(t);
    const snapshot = useBackendState.getState().snapshot;
    if (!snapshot || !sessionId) return;
    const baseRevision = snapshot.revision;
    const compiled = interpolate1D(TIME_OF_DAY_ANCHORS, t);
    // Skip locked keys so live preview matches what backend will compute.
    const bindings = [
      { paramKey: 'time_of_day.position', value: t },
      ...Object.entries(compiled)
        .filter(([key]) => !lockedSet.has(key))
        .map(([paramKey, value]) => ({ paramKey, value })),
    ];
    useBackendState.getState().applyOptimistic(
      `canon:${layerId}:compound`,
      { bindings, baseRevision },
    );
  }, [setPosition, sessionId, layerId, lockedSet]);

  // Per-card edit: optimistic patch the single key, debounce a set_widget_param
  // call. Backend implicitly locks the key on receipt.
  const debouncers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const editParam = useCallback((paramKey: string, value: number) => {
    const snapshot = useBackendState.getState().snapshot;
    const sid = useBackendState.getState().sessionId;
    if (!snapshot || !sid) return;
    // Merge into the existing compound optimistic patch so the dial drag's
    // pending bundle isn't blown away by a stale revision.
    const existing = useBackendState.getState().optimistic.get(`canon:${layerId}:compound`);
    const next = existing
      ? existing.bindings.filter((b) => b.paramKey !== paramKey)
      : [];
    next.push({ paramKey, value });
    useBackendState.getState().applyOptimistic(
      `canon:${layerId}:compound`,
      { bindings: next, baseRevision: snapshot.revision },
    );
    const prev = debouncers.current.get(paramKey);
    if (prev) clearTimeout(prev);
    debouncers.current.set(paramKey, setTimeout(() => {
      void backendTools.set_widget_param(sid, { widget_id: widget.id, param_key: paramKey, value });
    }, DEBOUNCE_MS));
  }, [layerId, widget.id]);

  const unlockParam = useCallback((paramKey: string) => {
    const sid = useBackendState.getState().sessionId;
    if (!sid) return;
    void backendTools.unlock_widget_param(sid, { widget_id: widget.id, param_key: paramKey });
  }, [widget.id]);

  return (
    <div className="flex flex-col gap-2">
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={position}
        onPositionChange={handleChange}
      />
      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
        {BUNDLE_KEYS.map((key) => {
          const binding = bindingByKey.get(key);
          // Use the binding's control_schema for live ranges (kept in lockstep
          // with the engine registry by the backend template). Fall back to a
          // conservative bipolar range if a binding hasn't arrived yet.
          const schema = binding?.control_schema;
          const range = schema && schema.control_type === 'slider'
            ? { min: schema.min, max: schema.max, step: schema.step }
            : { min: -100, max: 100, step: 1 };
          return (
            <EditableParamCard
              key={key}
              label={LABELS[key] ?? key}
              value={readValue(key)}
              unit={UNITS[key]}
              min={range.min}
              max={range.max}
              step={range.step}
              locked={lockedSet.has(key)}
              onChange={(v) => editParam(key, v)}
              onUnlock={() => unlockParam(key)}
            />
          );
        })}
      </div>
    </div>
  );
}
