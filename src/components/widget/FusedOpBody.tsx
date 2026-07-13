import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Widget, ControlBinding, ControlValue } from '@/types/widget';
import type { OpSlice } from '@/lib/widget-slices';
import { RegistryDrivenPanel } from '@/components/inspector/RegistryDrivenPanel';
import { HslWidgetBody, isHslWidget } from './HslWidgetBody';
import { LevelsWidgetBody, isFullLevelsWidget } from './LevelsWidgetBody';
import { CurvesWidgetBody, isCurvesWidget, isCurveBinding } from './CurvesWidgetBody';

interface FusedOpBodyProps {
  /** The full parent widget — needed by rich body predicates and adapters. */
  parentWidget: Widget;
  /** The single op-slice this body renders (from sliceWidgetByOp). */
  slice: OpSlice;
  /** Optimistic-aware value reader (provided by WidgetShell or FusedSliceNode). */
  effectiveValue: (binding: ControlBinding) => ControlValue;
  /** Write a param back through the parent widget's set_widget_param path. */
  setParam: (paramKey: string, value: ControlBinding['value']) => void;
  disabled?: boolean;
  /** Pin-slot renderer — only wired for the flat fallback path. */
  renderPinSlot?: (paramKey: string, label: string) => ReactNode;
}

/**
 * Body dispatcher for one op-section inside a fused widget (or a break-out
 * projection satellite).
 *
 * Builds a SLICED view of the parent widget — a Widget whose `nodes` array
 * contains only the single op-node and whose `bindings` are the subset that
 * target that node.  The rich body predicates (`isHslWidget`, `isFullLevels-
 * Widget`, `isCurvesWidget`) key off this view's bindings and nodes, so the
 * same dispatch logic that WidgetShell uses for standalone widgets works here
 * without modification.
 *
 * Dispatch order (mirrors WidgetShell):
 *   1. HSL node → HslWidgetBody
 *   2. Full Levels triple → LevelsWidgetBody
 *   3. Curves binding(s) → CurvesWidgetBody  (+ non-curve extras as rows)
 *   4. else → RegistryDrivenPanel (flat sliders)
 *
 * `effectiveValue` is already optimistic-aware (supplied by the parent shell
 * or the satellite), so HSL/Levels/Curves params track live driver drags and
 * debounced backend echoes without any extra wiring here.
 *
 * Pin slots are only rendered on the flat path — rich bodies don't expose the
 * per-binding pin affordance (pins remain accessible via the section header's
 * release-all button and the parent WidgetShell).
 */
export function FusedOpBody({
  parentWidget,
  slice,
  effectiveValue,
  setParam,
  disabled,
  renderPinSlot,
}: FusedOpBodyProps) {
  // Build the sliced Widget view once.  Re-computed only when the parent
  // widget reference or the slice nodeId changes (both stable across driver
  // drags thanks to Zustand selectors).
  const slicedView: Widget = useMemo(() => {
    const opNode = parentWidget.nodes.find((n) => n.id === slice.nodeId);
    return {
      ...parentWidget,
      nodes: opNode ? [opNode] : [],
      bindings: slice.bindings,
    };
  }, [parentWidget, slice.nodeId, slice.bindings]);

  // ── Rich body dispatch ──────────────────────────────────────────────────

  if (isHslWidget(slicedView)) {
    return (
      <div className="px-1.5 py-1">
        <HslWidgetBody
          widget={slicedView}
          effectiveValue={effectiveValue}
          setParam={setParam}
        />
      </div>
    );
  }

  if (isFullLevelsWidget(slicedView)) {
    return (
      <div className="px-1.5 py-1">
        <LevelsWidgetBody
          widget={slicedView}
          effectiveValue={effectiveValue}
          setParam={setParam}
        />
      </div>
    );
  }

  if (isCurvesWidget(slicedView)) {
    // Non-curve bindings on a curves slice (e.g. a saturation slider that
    // accompanies a luma curve in an AI-composed fused op).  Render them as
    // a flat RegistryDrivenPanel section beneath the curve editor.
    const extraBindings = slice.bindings.filter((b) => !isCurveBinding(b));
    const extraValues: Record<string, unknown> = {};
    for (const b of extraBindings) {
      extraValues[b.paramKey] = effectiveValue(b);
    }
    // Derive a minimal RegistryOp for the extras from the parent op, filtering
    // op.bindings to only those whose paramKey appears in the extra set.
    const extraParamKeys = new Set(extraBindings.map((b) => b.paramKey));
    const extraOp = {
      ...slice.op,
      bindings: slice.op.bindings.filter((ob) => extraParamKeys.has(ob.paramKey)),
    };

    return (
      <div className="py-1">
        <CurvesWidgetBody
          widget={slicedView}
          effectiveValue={effectiveValue}
          setParam={setParam}
        />
        {extraBindings.length > 0 && (
          <RegistryDrivenPanel
            op={extraOp}
            values={extraValues}
            onParamChange={(paramKey, value) =>
              setParam(paramKey, value as ControlBinding['value'])
            }
            disabled={disabled}
          />
        )}
      </div>
    );
  }

  // ── Flat fallback (sliders via RegistryDrivenPanel) ─────────────────────

  // Build the values map from effectiveValue so optimistic patches flow here
  // too (matches what FusedWidgetBody used to do for its opValues).
  const values: Record<string, unknown> = {};
  for (const b of slice.bindings) {
    values[b.paramKey] = effectiveValue(b);
  }

  return (
    <RegistryDrivenPanel
      op={slice.op}
      values={values}
      onParamChange={(paramKey, value) =>
        setParam(paramKey, value as ControlBinding['value'])
      }
      disabled={disabled}
      renderPinSlot={renderPinSlot}
    />
  );
}
