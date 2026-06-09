import { useCallback, useMemo, useRef } from 'react';
import type { Widget, ControlBinding } from '@/types/widget';
import { PerceptualDialBody } from '@/components/workspace/PerceptualDialBody';
import { CircularDial } from './compound/CircularDial';
import { EditableParamCard } from '@/components/ui/EditableParamCard';
import { useProcessingParam } from '@/lib/use-processing-param';
import { interpolate1D } from '@/lib/perceptual-dial/interpolate';
import type { Anchor } from '@/lib/perceptual-dial/types';
import { loadRegistry } from '@/lib/registry/loader';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

const DEBOUNCE_MS = 300;

/** Convert registry compound anchors → legacy PerceptualDialBody `Anchor[]`.
 *  Also carries optional `color` for wheel topology wedge coloring. */
function toDialAnchors(opId: string): Array<Anchor & { color?: string }> {
  const op = loadRegistry().ops[opId];
  if (!op?.compound) return [];
  return op.compound.anchors.map((a) => ({
    id: a.name,
    label: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    position: [a.position],
    params: a.values,
    color: a.color ?? undefined,
  }));
}

export function pickDialComponent(topology: 'linear' | 'wheel' | undefined) {
  if (topology === 'wheel') return CircularDial;
  return PerceptualDialBody;
}

interface CompoundWidgetBodyProps {
  widget: Widget;
}

/** Generic body for any registry op that has a `compound` block. Renders:
 *  - The driver-param slider via PerceptualDialBody
 *  - Per-anchor bundle cards via EditableParamCard (live interpolated values)
 *  - Optimistic patches keyed by `canon:<layerId>:<nodeType>`
 *
 * Mirrors TimeOfDayWidgetBody but sources anchor/driver/label data from the
 * SSoT registry rather than hard-coded constants.
 */
export function CompoundWidgetBody({ widget }: CompoundWidgetBodyProps) {
  const op = loadRegistry().ops[widget.op_id ?? ''];
  // Defensive — ToolSection should only dispatch here for compound ops.
  if (!op?.compound) return null;

  const driverKey = op.compound.driver;
  const nodeType = widget.nodes[0]?.type ?? 'compound';
  const layerId = widget.nodes[0]?.layer_id ?? '';

  const driverParam = op.params[driverKey];
  const driverDefault = (driverParam?.default as number | undefined) ?? 0.5;

  const [position, setPosition] = useProcessingParam(
    layerId, nodeType, widget.id, driverKey, driverDefault,
  );

  // Live values for the cards: prefer optimistic compound patch, fall back to
  // widget bindings, fall back to fresh interpolation.
  const optimisticBundle = useBackendState(
    (s) => s.optimistic.get(`canon:${layerId}:${nodeType}`),
  );
  const lockedSet = useMemo(
    () => new Set(widget.locked_params ?? []),
    [widget.locked_params],
  );
  const bindingByKey = useMemo(() => {
    const m = new Map<string, ControlBinding>();
    for (const b of widget.bindings) m.set(b.param_key, b);
    return m;
  }, [widget.bindings]);

  // Stable anchor list loaded once from the registry.
  const dialAnchors = useMemo(
    () => toDialAnchors(widget.op_id ?? ''),
    [widget.op_id],
  );

  const interpolated = useMemo(
    () => interpolate1D(dialAnchors, position),
    [dialAnchors, position],
  );

  /** Bundle keys: union of anchor value keys, ordered by op.bindings declaration,
   *  excluding the driver so it doesn't appear as a card. */
  const bundleKeys = useMemo(() => {
    const anchorKeys = new Set<string>();
    for (const a of op.compound!.anchors) {
      for (const k of Object.keys(a.values)) anchorKeys.add(k);
    }
    return op.bindings
      .map((b) => b.param_key)
      .filter((k) => k !== driverKey && anchorKeys.has(k));
  }, [op.bindings, op.compound, driverKey]);

  function readValue(key: string): number {
    if (optimisticBundle) {
      const opt = optimisticBundle.bindings.find((b) => b.paramKey === key);
      if (opt !== undefined && typeof opt.value === 'number') return opt.value;
    }
    const binding = bindingByKey.get(key);
    if (binding && typeof binding.value === 'number') return binding.value;
    return interpolated[key] ?? 0;
  }

  // Dial drag: write an optimistic compound patch (renderer reads via canon key),
  // then debounced set_widget_param handled by useProcessingParam internally.
  const handleChange = useCallback((t: number) => {
    setPosition(t);
    const snapshot = useBackendState.getState().snapshot;
    const sid = useBackendState.getState().sessionId;
    if (!snapshot || !sid) return;
    const baseRevision = snapshot.revision;
    const compiled = interpolate1D(dialAnchors, t);
    // Skip locked keys so live preview matches what backend will compute.
    const bindings = [
      { paramKey: driverKey, value: t },
      ...Object.entries(compiled)
        .filter(([key]) => !lockedSet.has(key))
        .map(([paramKey, value]) => ({ paramKey, value })),
    ];
    useBackendState.getState().applyOptimistic(
      `canon:${layerId}:${nodeType}`,
      { bindings, baseRevision },
    );
  }, [setPosition, dialAnchors, layerId, nodeType, driverKey, lockedSet]);

  // Per-card edit: merge optimistic patch for that single key, debounce
  // set_widget_param so the backend implicitly locks the key on receipt.
  const debouncers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const editParam = useCallback((paramKey: string, value: number) => {
    const snapshot = useBackendState.getState().snapshot;
    const sid = useBackendState.getState().sessionId;
    if (!snapshot || !sid) return;
    const existing = useBackendState.getState().optimistic.get(`canon:${layerId}:${nodeType}`);
    const next = existing
      ? existing.bindings.filter((b) => b.paramKey !== paramKey)
      : [];
    next.push({ paramKey, value });
    useBackendState.getState().applyOptimistic(
      `canon:${layerId}:${nodeType}`,
      { bindings: next, baseRevision: snapshot.revision },
    );
    const prev = debouncers.current.get(paramKey);
    if (prev) clearTimeout(prev);
    debouncers.current.set(paramKey, setTimeout(() => {
      void backendTools.set_widget_param(sid, { widget_id: widget.id, param_key: paramKey, value });
    }, DEBOUNCE_MS));
  }, [layerId, nodeType, widget.id]);

  const unlockParam = useCallback((paramKey: string) => {
    const sid = useBackendState.getState().sessionId;
    if (!sid) return;
    void backendTools.unlock_widget_param(sid, { widget_id: widget.id, param_key: paramKey });
  }, [widget.id]);

  const labelByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of op.bindings) m[b.param_key] = b.label;
    return m;
  }, [op.bindings]);

  const unitByKey = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const [k, p] of Object.entries(op.params)) m[k] = p.unit;
    return m;
  }, [op.params]);

  const topology = op.compound?.topology ?? 'linear';

  return (
    <div className="flex flex-col gap-2">
      {topology === 'wheel' ? (
        <CircularDial
          anchors={dialAnchors}
          position={position}
          onPositionChange={handleChange}
        />
      ) : (
        <PerceptualDialBody
          topology="1d-slider"
          anchors={dialAnchors}
          position={position}
          onPositionChange={handleChange}
        />
      )}
      <div className="grid grid-cols-2 gap-1.5 px-2 pb-2">
        {bundleKeys.map((key) => {
          const binding = bindingByKey.get(key);
          const schema = binding?.control_schema;
          const range = schema && schema.control_type === 'slider'
            ? { min: schema.min, max: schema.max, step: schema.step }
            : { min: -100, max: 100, step: 1 };
          return (
            <EditableParamCard
              key={key}
              label={labelByKey[key] ?? key}
              value={readValue(key)}
              unit={unitByKey[key]}
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
