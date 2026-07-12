import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Handle, Position } from '@xyflow/react';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Widget, ControlBinding } from '@/types/widget';
import { RegistryDrivenPanel } from '@/components/inspector/RegistryDrivenPanel';
import { FusedPinButton } from '@/components/widget/FusedWidgetBody';
import { sliceWidgetByOp } from '@/lib/widget-slices';
import { useBackendState, type OptimisticPatch } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { touchKey } from '@/hooks/useParamProvenance';
import { loadRegistry } from '@/lib/registry/loader';

const EMPTY_WIDGETS: Widget[] = [];

/** Parent intent/displayName, mirroring WidgetShellHeader's resolveTitle. */
function resolveParentTitle(widget: Widget): string {
  if (widget.displayName) return widget.displayName;
  const reg = loadRegistry();
  const op = widget.opId ? reg.ops[widget.opId] : undefined;
  if (op) return op.display_name;
  return widget.intent;
}

export interface FusedSliceNodeData extends Record<string, unknown> {
  /** Store id of the satellite (`slice:<parentWidgetId>:<nodeId>`). */
  sliceId: string;
}

interface FusedSliceNodeProps {
  data: FusedSliceNodeData;
  selected: boolean;
}

/**
 * Break-out projection satellite for one op-node of a fused parent widget.
 *
 * Frontend-only: looks up the parent widget in the backend snapshot and renders
 * that op's REAL controls (via `sliceWidgetByOp` filtered to `nodeId`). Every
 * edit routes to `set_widget_param(parentWidgetId, …)` — so pinning, refine, and
 * undo fall out of the parent's own flow; the backend never learns the satellite
 * exists. Closing it (`removeFusedSliceNode`) is pure UI.
 *
 * Prune guard: if the parent widget is gone from the snapshot (dismissed) OR the
 * op-node is gone (detached via the ⋯ menu), the satellite renders nothing and
 * self-removes on the next frame.
 */
export function FusedSliceNode({ data, selected }: FusedSliceNodeProps) {
  const { sliceId } = data;

  const slice = useEditorStore((s) => s.fusedSliceNodes[sliceId]);
  const removeFusedSliceNode = useEditorStore((s) => s.removeFusedSliceNode);

  const parentWidgetId = slice?.parentWidgetId;
  const nodeId = slice?.nodeId;

  const parent = useBackendState((s) =>
    (s.snapshot?.widgets ?? EMPTY_WIDGETS).find(
      (w) => w.id === parentWidgetId && w.status === 'active',
    ),
  );

  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  // The single op-slice this satellite projects (null if the node is gone —
  // e.g. detached). Derived, so a detach on the parent prunes automatically.
  const opSlice = useMemo(() => {
    if (!parent || !nodeId) return null;
    return sliceWidgetByOp(parent).find((sl) => sl.nodeId === nodeId) ?? null;
  }, [parent, nodeId]);

  // Subscribe to the parent op-node's optimistic patch (canonical key) so driver
  // drags on the parent live-update the satellite's values — same read path as
  // WidgetShell's effectiveValue.
  const parentNode = parent?.nodes.find((n) => n.id === nodeId);
  const canonKey = parentNode ? `canon:${parentNode.layerId}:${parentNode.type}` : null;
  const optimistic = useBackendState(
    useShallow((s): OptimisticPatch | undefined =>
      canonKey ? s.optimistic.get(canonKey) : undefined,
    ),
  );

  // Prune: parent dismissed or op-node gone → self-remove. Runs in an effect so
  // the render stays pure (returns null below in the same frame).
  const gone = !slice || !parent || !opSlice;
  useEffect(() => {
    if (gone && slice) removeFusedSliceNode(sliceId);
  }, [gone, slice, sliceId, removeFusedSliceNode]);

  // Coalesce backend writes per paramKey — mirrors WidgetShell.setParam.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const onParamChange = useCallback(
    (paramKey: string, value: unknown) => {
      if (!sessionId || offline || !parentWidgetId || !parentNode) return;
      const binding = opSlice?.bindings.find(
        (b) => b.paramKey === paramKey || b.target.paramKey === paramKey,
      );
      const outKey = binding?.paramKey ?? paramKey;
      const targetKey = binding?.target.paramKey ?? paramKey;

      // Optimistic: patch the canonical op node(s) so the WebGL render previews
      // instantly. Fan out across every target layer, like WidgetShell.
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      const layerIds = parentNode.layerIds ?? (parentNode.layerId ? [parentNode.layerId] : []);
      const patch = { bindings: [{ paramKey: targetKey, value: value as number }], baseRevision };
      for (const lid of layerIds) {
        useBackendState.getState().applyOptimistic(`canon:${lid}:${parentNode.type}`, patch);
      }
      if (parentNode.layerId) {
        useEditorStore.getState().markParamTouched(
          touchKey(parentNode.layerId, parentNode.type, targetKey),
        );
      }

      // Debounced write, routed as the PARENT widget's edit.
      const existing = timersRef.current.get(outKey);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timersRef.current.delete(outKey);
        if (!mountedRef.current) return;
        void backendTools.set_widget_param(sessionId, {
          widgetId: parentWidgetId,
          paramKey: outKey,
          value: value as number,
        });
      }, 100);
      timersRef.current.set(outKey, timer);
    },
    [sessionId, offline, parentWidgetId, parentNode, opSlice],
  );

  if (gone || !parent || !opSlice || !parentWidgetId) return null;

  const lockedSet = new Set(parent.lockedParams ?? []);

  // Live values: bindings' current value overlaid with any optimistic patch, so
  // a parent driver drag reflects here immediately.
  const values: Record<string, unknown> = {};
  for (const b of opSlice.bindings) {
    const opt = optimistic?.bindings.find((p) => p.paramKey === b.target.paramKey);
    values[b.paramKey] = opt !== undefined ? opt.value : b.value;
  }

  return (
    <>
      {/* Hub-tether outlets — one per side, so the edge to the parent widget
          node routes to whichever side faces it (pickTetherHandles). */}
      <Handle type="source" position={Position.Top} id="tether-out-top" className="tether-outlet" />
      <Handle type="source" position={Position.Bottom} id="tether-out-bottom" className="tether-outlet" />
      <Handle type="source" position={Position.Left} id="tether-out-left" className="tether-outlet" />
      <Handle type="source" position={Position.Right} id="tether-out-right" className="tether-outlet" />
      <div
        className={`overlay w-fit ${selected ? 'workspace-node-selected' : ''}`}
        style={{ minWidth: 226 }}
      >
        {/* Header — op name + provenance ("from …") + close (pure UI). The
            whole strip is the drag handle; the close button opts out. */}
        <div className="workspace-drag-handle flex items-center gap-1.5 px-2.5 py-1.5 border-b border-separator/60 cursor-grab">
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-[11px] font-medium text-text-primary leading-tight">
              {opSlice.op.display_name}
            </span>
            <span className="truncate text-[9px] text-text-secondary leading-tight">
              from “{resolveParentTitle(parent)}”
            </span>
          </div>
          <button
            type="button"
            aria-label="Close projection"
            title="Close — remove this satellite (the intent widget is unchanged)"
            onClick={(e) => { e.stopPropagation(); removeFusedSliceNode(sliceId); }}
            className="nodrag inline-flex items-center justify-center size-4 rounded-[3px]
              text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors shrink-0"
          >
            <X size={12} aria-hidden />
          </button>
        </div>

        {/* Body — the op's real controls, edits routed to the parent widget. */}
        <RegistryDrivenPanel
          op={opSlice.op}
          values={values}
          onParamChange={onParamChange}
          disabled={offline}
          renderPinSlot={(paramKey) => {
            const binding = opSlice.bindings.find((b) => b.paramKey === paramKey);
            const targetKey = binding?.target.paramKey ?? paramKey;
            return (
              <FusedPinButton
                widgetId={parentWidgetId}
                paramKey={targetKey}
                isPinned={lockedSet.has(targetKey) || lockedSet.has(paramKey)}
              />
            );
          }}
        />
      </div>
    </>
  );
}

/** Typed control-binding alias used by tests/consumers. */
export type FusedSliceBinding = ControlBinding;
