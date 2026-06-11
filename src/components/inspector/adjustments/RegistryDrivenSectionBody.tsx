import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { loadRegistry } from '@/lib/registry/loader';
import { RegistryDrivenPanel } from '../RegistryDrivenPanel';
import { ScalarSectionBody } from './ScalarSectionBody';
import { SliderPinMenu } from './SliderPinMenu';
import { touchKey } from '@/hooks/useParamProvenance';
import type { ParamDefinition } from '@/types/processing';
import type { Widget, ControlBinding } from '@/types/widget';
import type { RegistryOp } from '../../../../shared/registry/schema';

const DEBOUNCE_MS = 300;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Toolrail (canonical) props — used by ToolSection for per-def sliders.
// ---------------------------------------------------------------------------
interface ToolrailProps {
  /** ProcessingDefinition.id — used to look up the registry op. */
  defId: string;
  /** ProcessingDefinition.adjustmentType — used as `op` for canonical node id. */
  opType: string;
  layerId: string;
  /** Fallback params from ProcessingDefinition if no registry entry (should not happen). */
  params: ParamDefinition[];
  widget?: never;
  disabled?: never;
}

// ---------------------------------------------------------------------------
// Widget props — used when rendering a Widget's bindings directly (e.g.
// future widget-section renderers). Supports multi-op widgets by slicing
// bindings per node and rendering a section header per op.
// ---------------------------------------------------------------------------
interface WidgetProps {
  widget: Widget;
  disabled: boolean;
  defId?: never;
  opType?: never;
  layerId?: never;
  params?: never;
}

type RegistryDrivenSectionBodyProps = ToolrailProps | WidgetProps;

// ---------------------------------------------------------------------------
// Multi-op slicing helpers
// ---------------------------------------------------------------------------

interface OpSlice {
  op: RegistryOp;
  bindings: ControlBinding[];
  values: Record<string, unknown>;
  nodeId: string;
}

function sliceWidgetByOp(widget: Widget): OpSlice[] {
  const reg = loadRegistry();
  const slices: OpSlice[] = [];
  for (const node of widget.nodes) {
    let op = node.op_id ? reg.ops[node.op_id] : undefined;
    if (!op) {
      // Back-compat: nodes without op_id (e.g. persisted before this feature) — match by node_type.
      op = Object.values(reg.ops).find((o) => o.engine.node_type === node.type);
    }
    if (!op) {
      console.warn(`RegistryDrivenSectionBody: no registry op for node ${node.id} (type=${node.type}, op_id=${node.op_id ?? 'none'})`);
      continue;
    }
    const bindings = widget.bindings.filter((b) => b.target?.nodeId === node.id);
    const values: Record<string, unknown> = {};
    for (const b of bindings) values[b.paramKey] = b.value;
    slices.push({ op, bindings, values, nodeId: node.id });
  }
  return slices;
}

// ---------------------------------------------------------------------------
// Widget-based multi-op renderer (stateless — parent owns onParamChange).
// ---------------------------------------------------------------------------

interface WidgetSectionBodyInnerProps {
  widget: Widget;
  disabled: boolean;
}

function WidgetSectionBodyInner({ widget, disabled }: WidgetSectionBodyInnerProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const isDisabled = disabled || offline;

  const onParamChange = useCallback(
    (paramKey: string, value: unknown) => {
      if (!sessionId || offline) return;
      void backendTools.set_widget_param(sessionId, {
        widgetId: widget.id,
        paramKey,
        value: value as number,
      });
    },
    [sessionId, offline, widget.id],
  );

  const slices = sliceWidgetByOp(widget);

  if (slices.length === 0) return null;

  if (slices.length === 1) {
    const s = slices[0];
    return (
      <RegistryDrivenPanel
        op={s.op}
        values={s.values}
        onParamChange={onParamChange}
        disabled={isDisabled}
      />
    );
  }

  return (
    <>
      {slices.map((s) => (
        <div key={s.nodeId}>
          <div className="registry-panel-section-title">{s.op.display_name}</div>
          <RegistryDrivenPanel
            op={s.op}
            values={s.values}
            onParamChange={onParamChange}
            disabled={isDisabled}
          />
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Toolrail-based canonical renderer (original implementation).
// ---------------------------------------------------------------------------

interface ToolrailSectionBodyInnerProps {
  defId: string;
  opType: string;
  layerId: string;
  params: ParamDefinition[];
}

function ToolrailSectionBodyInner({
  defId,
  opType,
  layerId,
  params,
}: ToolrailSectionBodyInnerProps) {
  const reg = loadRegistry();
  const registryOp = reg.ops[defId];

  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const nodeId = `canon:${layerId}:${opType}`;

  // Read all param values from the canonical node (with optimistic overlay).
  // useShallow performs a shallow comparison of the returned object so Zustand
  // doesn't trigger a re-render when individual values haven't changed, avoiding
  // the "getSnapshot should be cached" infinite-loop warning.
  const values = useBackendState(
    useShallow((s) => {
      const result: Record<string, unknown> = {};
      if (!registryOp) return result;
      for (const binding of registryOp.bindings) {
        const param = registryOp.params[binding.paramKey];
        const defaultVal = param.default;
        const opt = s.optimistic.get(nodeId);
        const hit = opt?.bindings.find((b) => b.paramKey === binding.paramKey);
        if (hit !== undefined) {
          result[binding.paramKey] = hit.value;
          continue;
        }
        const node = s.snapshot?.operationGraph.nodes.find((n) => n.id === nodeId);
        const v = node?.params?.[binding.paramKey];
        result[binding.paramKey] = v === undefined ? defaultVal : v;
      }
      return result;
    }),
  );

  const onParamChange = useCallback(
    (paramKey: string, value: unknown) => {
      if (!sessionId || offline) return;
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      // Mark the param as hand-touched for provenance colouring.
      useEditorStore.getState().markParamTouched(touchKey(layerId, opType, paramKey));
      // Optimistic patch for instant feedback.
      useBackendState.getState().applyOptimistic(nodeId, {
        bindings: [{ paramKey, value: value as number }],
        baseRevision,
      });
      // Debounced backend write.
      const timerKey = `${nodeId}:${paramKey}`;
      const existing = debounceTimers.get(timerKey);
      if (existing) clearTimeout(existing);
      debounceTimers.set(
        timerKey,
        setTimeout(() => {
          debounceTimers.delete(timerKey);
          void backendTools.set_param(sessionId, {
            layerId,
            op: opType,
            param: paramKey,
            value: value as number,
          });
        }, DEBOUNCE_MS),
      );
    },
    [sessionId, offline, layerId, opType, nodeId],
  );

  if (!registryOp) {
    // Fallback: op not yet in the registry — use the bespoke scalar body.
    return <ScalarSectionBody toolId={defId} layerId={layerId} op={opType} params={params} />;
  }

  return (
    <RegistryDrivenPanel
      op={registryOp}
      values={values}
      onParamChange={onParamChange}
      disabled={offline}
      renderPinSlot={(paramKey, label) => (
        <SliderPinMenu
          toolId={defId}
          opAdjustmentType={opType}
          layerId={layerId}
          paramKey={paramKey}
          paramLabel={label}
        />
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Public component — dispatches to toolrail or widget path based on props.
// ---------------------------------------------------------------------------

/**
 * Wires RegistryDrivenPanel to the backend store.
 *
 * Two call patterns:
 *  - Toolrail (canonical): pass `defId`, `opType`, `layerId`, `params`.
 *    Falls back to ScalarSectionBody if the op isn't in the registry yet.
 *  - Widget-based: pass `widget` + `disabled`.
 *    For single-op widgets renders flat (no header).
 *    For multi-op widgets renders one section header + panel per op.
 */
export function RegistryDrivenSectionBody(props: RegistryDrivenSectionBodyProps) {
  if (props.widget !== undefined) {
    return <WidgetSectionBodyInner widget={props.widget} disabled={props.disabled} />;
  }
  return (
    <ToolrailSectionBodyInner
      defId={props.defId}
      opType={props.opType}
      layerId={props.layerId}
      params={props.params}
    />
  );
}
