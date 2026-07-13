import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Scissors, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { Widget, ControlBinding } from '@/types/widget';
import { FusedOpBody } from '@/components/widget/FusedOpBody';
import { FusedPinButton } from '@/components/widget/FusedWidgetBody';
import { sliceWidgetByOp } from '@/lib/widget-slices';
import { useBackendState, type OptimisticPatch } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { touchKey } from '@/hooks/useParamProvenance';
import { loadRegistry } from '@/lib/registry/loader';

const EMPTY_WIDGETS: Widget[] = [];

/** How long (ms) the detach button stays "armed" before auto-resetting. */
const DETACH_REARM_MS = 3000;

/** Parent intent/displayName, mirroring WidgetShellHeader's resolveTitle. */
function resolveParentTitle(widget: Widget): string {
  if (widget.displayName) return widget.displayName;
  const reg = loadRegistry();
  const op = widget.opId ? reg.ops[widget.opId] : undefined;
  if (op) return op.display_name;
  return widget.intent;
}

// ─── DetachButton ──────────────────────────────────────────────────────────────
//
// Two-click inline confirm:
//   click 1 → arms the button (accent color, title changes)
//   click 2 → calls detach_widget_op and immediately removes the satellite
//
// Auto-resets if the user doesn't confirm within DETACH_REARM_MS or blurs away.
// Hidden/disabled when the parent only has one node (detaching the only op
// would leave the fused widget empty — dismiss it instead).

interface DetachButtonProps {
  sessionId: string | null;
  offline: boolean;
  parentWidgetId: string;
  nodeId: string;
  /** Number of nodes in the parent widget. Used to guard the single-node case. */
  parentNodeCount: number;
  onDetached: () => void;
}

function DetachButton({
  sessionId,
  offline,
  parentWidgetId,
  nodeId,
  parentNodeCount,
  onDetached,
}: DetachButtonProps) {
  const [armed, setArmed] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-fire guard: setArmed(false) is batched, so a rapid extra click in
  // the same tick still sees armed===true in the closure and would send a
  // second detach_widget_op. The ref flips synchronously.
  const inFlightRef = useRef(false);

  // Clear the auto-reset timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const disarm = useCallback(() => {
    clearResetTimer();
    setArmed(false);
  }, [clearResetTimer]);

  const isSingleNode = parentNodeCount <= 1;
  const isDisabled = isSingleNode || offline || !sessionId;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isDisabled) return;

      if (!armed) {
        // First click: arm the button.
        setArmed(true);
        resetTimerRef.current = setTimeout(disarm, DETACH_REARM_MS);
        return;
      }

      // Second click: confirm detach.
      clearResetTimer();
      setArmed(false);
      if (!sessionId || inFlightRef.current) return;
      inFlightRef.current = true;
      void backendTools
        .detach_widget_op(sessionId, { widgetId: parentWidgetId, nodeId })
        .then((res) => {
          inFlightRef.current = false;
          if (res.ok) onDetached();
        })
        .catch(() => {
          inFlightRef.current = false;
        });
    },
    [armed, isDisabled, sessionId, parentWidgetId, nodeId, onDetached, disarm, clearResetTimer],
  );

  const handleBlur = useCallback(() => {
    if (armed) disarm();
  }, [armed, disarm]);

  const title = isSingleNode
    ? 'Only adjustment — dismiss the widget instead'
    : armed
      ? 'Click again to confirm detach'
      : 'Detach from intent — make this a standalone widget';

  const ariaLabel = armed ? 'Confirm detach from intent' : 'Detach from intent';

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      disabled={isDisabled}
      onClick={handleClick}
      onBlur={handleBlur}
      className={[
        'nodrag inline-flex items-center justify-center size-4 rounded-sm transition-colors shrink-0',
        isDisabled
          ? 'text-text-tertiary cursor-not-allowed opacity-50'
          : armed
            ? 'text-color-accent bg-color-accent/10 hover:bg-color-accent/20'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary',
      ].join(' ')}
    >
      <Scissors size={12} aria-hidden />
    </button>
  );
}

// ─── FusedSliceNode ─────────────────────────────────────────────────────────────

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
 *
 * Detach: the "Detach from intent" button on the header calls `detach_widget_op`
 * on the backend and then immediately removes the satellite. The new standalone
 * widget arrives via SSE `widget.created` and is tethered by `workspace-tether.ts`.
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

  // On successful detach: remove this satellite immediately. The new standalone
  // widget arrives via SSE widget.created and is positioned+tethered by
  // workspace-tether.ts (fused_expansion origin now allowed there).
  const handleDetached = useCallback(() => {
    removeFusedSliceNode(sliceId);
  }, [removeFusedSliceNode, sliceId]);

  if (gone || !parent || !opSlice || !parentWidgetId) return null;

  const lockedSet = new Set(parent.lockedParams ?? []);

  // Optimistic-aware value reader — mirrors WidgetShell.effectiveValue, scoped to
  // the single op-node this satellite projects.  The `optimistic` subscription above
  // covers the parent driver drags so rich bodies (HSL rail, histogram, curve editor)
  // update live without any extra wiring.
  function effectiveValue(b: ControlBinding): ControlBinding['value'] {
    const opt = optimistic?.bindings.find((p) => p.paramKey === b.target.paramKey);
    return opt !== undefined ? opt.value : b.value;
  }

  // setParam adapter: routes to the parent widget's set_widget_param path (same as
  // onParamChange below, but surfaces the ControlBinding['value'] type signature that
  // FusedOpBody and the rich bodies expect).
  function setParam(paramKey: string, value: ControlBinding['value']) {
    onParamChange(paramKey, value);
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
        style={{ minWidth: 320 }}
      >
        {/* Header — op name + provenance ("from …") + detach + close (pure UI).
            The whole strip is the drag handle; action buttons opt out. */}
        <div className="workspace-drag-handle flex items-center gap-1.5 px-2.5 py-1.5 border-b border-separator/60 cursor-grab">
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate text-[11px] font-medium text-text-primary leading-tight">
              {opSlice.op.display_name}
            </span>
            <span className="truncate text-[9px] text-text-secondary leading-tight">
              from "{resolveParentTitle(parent)}"
            </span>
          </div>
          <DetachButton
            sessionId={sessionId}
            offline={offline}
            parentWidgetId={parentWidgetId}
            nodeId={nodeId ?? ''}
            parentNodeCount={parent.nodes.length}
            onDetached={handleDetached}
          />
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

        {/* Body — the op's real controls, edits routed to the parent widget.
            FusedOpBody dispatches to rich bodies (HSL rail, Levels histogram,
            Curves editor) when the slice qualifies, or falls back to flat sliders. */}
        <FusedOpBody
          parentWidget={parent}
          slice={opSlice}
          effectiveValue={effectiveValue}
          setParam={setParam}
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
