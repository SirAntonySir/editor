import { useCallback, useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { RUNTIME } from '@/config';
import type { ControlValue } from '@/types/widget';

/** Discriminated target for {@link useParam}.
 *
 *  Canonical: write directly to the (layer, op, param) triple via the
 *  `set_param` tool; optimistic patches are keyed on the canonical
 *  node id `canon:<layerId>:<op>` — which IS the op-graph node id.
 *
 *  Widget: write to a widget binding via `set_widget_param`; optimistic
 *  patches are keyed on the widget id (which is also the op-graph node
 *  id for the widget's underlying node). Reads prefer a widget binding
 *  value over the op-graph node param. */
export type ParamTarget =
  | { kind: 'canonical'; layerId: string | null; op: string; param: string }
  | { kind: 'widget'; widgetId: string | undefined; paramKey: string };

/** Single source of truth for debounced canonical/widget param writes.
 *
 *  Read path: optimistic patch → (widget bindings, widget target only) →
 *  op-graph node params → defaultValue.
 *
 *  Write path: applyOptimistic immediately for instant visual feedback;
 *  debounced backend-tool call (set_param or set_widget_param) at
 *  RUNTIME.sliderDebounceMs after the last keystroke.
 *
 *  Stale-write guard: if a backend history op (undo/redo/revert) clears
 *  s.optimistic between user input and the debounce firing, the
 *  scheduled tool call is suppressed so it can't push a new history
 *  entry that visually "undoes" the revert.
 *
 *  Both public wrappers (`useCanonicalParam`, `useProcessingParam`) are
 *  thin forwards to this. Bug fixes go here, not in the wrappers. */
export function useParam<T extends ControlValue = number>(
  target: ParamTarget,
  defaultValue: T,
): [T, (v: T) => void] {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  // Resolve the optimistic-map key + op-graph node id once per target.
  // Both are the same string for both target kinds: the canonical node
  // id (`canon:<layerId>:<op>`) for canonical, the widget id for widget.
  const optimisticKey =
    target.kind === 'canonical'
      ? target.layerId
        ? `canon:${target.layerId}:${target.op}`
        : ''
      : target.widgetId ?? '';
  const paramName = target.kind === 'canonical' ? target.param : target.paramKey;

  const value = useBackendState((s) => {
    if (!optimisticKey) return defaultValue;

    // 1. Optimistic patch — wins so slider drag feedback is instant.
    const patch = s.optimistic.get(optimisticKey);
    const opt = patch?.bindings.find((b) => b.paramKey === paramName);
    if (opt !== undefined) return opt.value as T;

    const snap = s.snapshot;
    if (!snap) return defaultValue;

    // 2. Widget binding (widget target only). A binding's value takes
    //    precedence over the node param because a widget can hold a
    //    different presentation value than the canonical param.
    if (target.kind === 'widget') {
      const widget = snap.widgets.find((w) => w.id === optimisticKey);
      const binding = widget?.bindings.find((b) => b.paramKey === paramName);
      if (binding !== undefined) return binding.value as T;
    }

    // 3. Op-graph node params.
    const node = snap.operationGraph.nodes.find((n) => n.id === optimisticKey);
    const p = node?.params?.[paramName];
    return p === undefined ? defaultValue : (p as T);
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending debounced write on unmount so a slider drag
  // interrupted by a panel close doesn't fire against a dead session.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const set = useCallback(
    (v: T) => {
      if (!optimisticKey || !sessionId || offline) return;
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      useBackendState.getState().applyOptimistic(optimisticKey, {
        bindings: [{ paramKey: paramName, value: v as ControlValue }],
        baseRevision,
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // Stale-write guard: a history op (undo/redo/revert) between
        // the user input and now would have cleared s.optimistic. If
        // our intended patch is no longer present, suppress the write.
        const opt = useBackendState.getState().optimistic.get(optimisticKey);
        const stillIntended = opt?.bindings.some(
          (b) => b.paramKey === paramName && b.value === (v as ControlValue),
        );
        if (!stillIntended) return;
        if (target.kind === 'canonical') {
          void backendTools.set_param(sessionId, {
            layerId: target.layerId!,
            op: target.op,
            param: target.param,
            value: v as ControlValue,
          });
        } else {
          void backendTools.set_widget_param(sessionId, {
            widgetId: optimisticKey,
            paramKey: target.paramKey,
            value: v as ControlValue,
          });
        }
      }, RUNTIME.sliderDebounceMs);
    },
    // target is a fresh object each render; we destructure stable
    // primitives into the closure via the `target.kind` / `optimisticKey`
    // / `paramName` derivations above. Adding `target` itself to deps
    // would force the callback to recreate every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, offline, optimisticKey, paramName, target.kind],
  );

  return [value, set];
}
