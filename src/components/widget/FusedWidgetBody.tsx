import { useState, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Widget, ControlBinding } from '@/types/widget';
import type { Anchor } from '@/lib/perceptual-dial/types';
import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { RegistryDrivenPanel } from '@/components/inspector/RegistryDrivenPanel';
import { interpolateExtended } from '@/lib/perceptual-dial/interpolate';
import { sliceWidgetByOp } from '@/lib/widget-slices';
import { useBackendState } from '@/store/backend-state-slice';

/** Convert widget-local compound anchors → Anchor[] for interpolateExtended.
 *  Strips the nodeId prefix from keys: `"nodeId:paramKey"` → `"paramKey"`. */
function toAnchors(
  anchors: NonNullable<Widget['compound']>['anchors'],
): Anchor[] {
  return anchors.map((a) => ({
    id: a.name,
    label: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    position: [a.position],
    params: Object.fromEntries(
      Object.entries(a.values).map(([k, v]) => [k.includes(':') ? k.split(':').slice(1).join(':') : k, v]),
    ),
  }));
}

interface FusedOpSectionProps {
  op: import('@shared/registry/schema').RegistryOp;
  values: Record<string, unknown>;
  onParamChange: (paramKey: string, value: unknown) => void;
  disabled?: boolean;
}

/** Collapsible section for one op within a fused widget. */
function FusedOpSection({ op, values, onParamChange, disabled }: FusedOpSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-separator/50 first:border-t-0">
      <button
        type="button"
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-[10px] text-text-secondary hover:text-text-primary transition-colors select-none"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span>{op.display_name}</span>
      </button>
      {open && (
        <RegistryDrivenPanel
          op={op}
          values={values}
          onParamChange={onParamChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}

interface FusedWidgetBodyProps {
  widget: Widget;
  effectiveValue: (binding: ControlBinding) => number | string | boolean | import('@/types/widget').CurvesValue;
  setParam: (paramKey: string, value: ControlBinding['value']) => void;
}

/**
 * Body for fused intent widgets (widget.compound present).
 *
 * Renders:
 * - One driver slider (0–150, proposal at 100, amber overshoot past 100)
 * - Collapsible per-op sections via FusedOpSection → RegistryDrivenPanel
 *
 * The driver value (t) lives in [0, 1.5] internally; the UI multiplies by 100.
 * Changing the driver calls applyOptimistic for every op node so the preview
 * stays live, mirroring the pattern in CompoundWidgetBody.
 */
export function FusedWidgetBody({ widget, effectiveValue, setParam }: FusedWidgetBodyProps) {
  const compound = widget.compound;

  // Driver t in [0, 1.5]: driverValue from the snapshot, default 1.0 (= 100).
  const initialT = (widget.driverValue != null ? widget.driverValue : 1.0);
  const [driverT, setDriverT] = useState<number>(initialT);

  // Ref to stabilise the timer map across renders without re-creating callbacks.
  const driverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slices = sliceWidgetByOp(widget);

  // Build anchors once; keys inside values will have nodeId stripped.
  const anchors: Anchor[] = compound ? toAnchors(compound.anchors) : [];

  // Interpolated per-paramKey values at current t. Used to seed RegistryDrivenPanel
  // and the optimistic patch (keyed `"{paramKey}"`).
  const interpolated = compound ? interpolateExtended(anchors, driverT) : {};

  const handleDriverChange = useCallback((displayVal: number) => {
    const t = displayVal / 100;
    setDriverT(t);

    // Optimistic: patch each op node so the WebGL render shows live preview.
    const snapshot = useBackendState.getState().snapshot;
    if (!snapshot) return;
    const baseRevision = snapshot.revision;

    for (const slice of slices) {
      const node = widget.nodes.find((n) => n.id === slice.nodeId);
      if (!node?.layerId) continue;

      // Build per-slice bindings: strip the nodeId prefix from anchor keys,
      // then pick only the params that belong to this node/op.
      const sliceParamKeys = new Set(slice.bindings.map((b) => b.target.paramKey));
      const opAnchors = compound
        ? toAnchors(
            compound.anchors.map((a) => ({
              ...a,
              values: Object.fromEntries(
                Object.entries(a.values)
                  .filter(([k]) => k.startsWith(`${node.id}:`))
                  .map(([k, v]) => [k.split(':').slice(1).join(':'), v]),
              ),
            })),
          )
        : [];
      const opInterpolated = interpolateExtended(opAnchors, t);
      const bindings = Object.entries(opInterpolated)
        .filter(([k]) => sliceParamKeys.has(k))
        .map(([paramKey, value]) => ({ paramKey, value }));

      if (bindings.length > 0) {
        useBackendState.getState().applyOptimistic(
          `canon:${node.layerId}:${node.type}`,
          { bindings, baseRevision },
        );
      }
    }

    // Debounce: send driver value to backend via __driver paramKey.
    if (driverTimerRef.current) clearTimeout(driverTimerRef.current);
    driverTimerRef.current = setTimeout(() => {
      setParam('__driver', t);
    }, 100);
  }, [slices, widget.nodes, compound, setParam]);

  if (!compound) return null;

  const driverLabel = compound.label ?? 'Strength';
  const displayT = driverT * 100;

  return (
    <div className="flex flex-col">
      {/* Driver slider — 0–150 display, amber overshoot past 100 */}
      <div className="px-2.5 py-2">
        <AdjustmentSlider
          label={driverLabel}
          value={displayT}
          min={0}
          max={150}
          step={1}
          defaultValue={100}
          neutralValue={100}
          overshootFrom={100}
          snapTo={100}
          provenance="ai"
          onChange={handleDriverChange}
        />
      </div>

      {/* Per-op collapsible sections */}
      <div className="flex flex-col">
        {slices.map((slice) => {
          // Build live values for this slice: prefer binding effectiveValue,
          // then fall back to interpolated value.
          const opValues: Record<string, unknown> = { ...interpolated };
          for (const b of slice.bindings) {
            const eff = effectiveValue(b);
            opValues[b.paramKey] = eff;
          }

          const handleOpParamChange = (paramKey: string, value: unknown) => {
            // Find the binding for this paramKey and call setParam.
            const binding = slice.bindings.find(
              (b) => b.paramKey === paramKey || b.target.paramKey === paramKey,
            );
            if (binding) {
              setParam(binding.paramKey, value as ControlBinding['value']);
            }
          };

          return (
            <FusedOpSection
              key={slice.nodeId}
              op={slice.op}
              values={opValues}
              onParamChange={handleOpParamChange}
            />
          );
        })}
      </div>
    </div>
  );
}
