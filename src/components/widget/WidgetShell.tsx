import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Widget, MaskSummary } from '@/types/widget';
import { backendTools } from '@/lib/backend-tools';
import { logWidgetUndoDiag } from '@/lib/widget-undo-diag';
import { useBackendState, type OptimisticPatch } from '@/store/backend-state-slice';
import { useWidgetExpansion } from '@/hooks/useWidgetExpansion';
import { useHoveredWidget } from '@/hooks/useHoveredWidget';
import { useEditorStore } from '@/store';
import { bindingProvenance, touchKey } from '@/hooks/useParamProvenance';
import { engineNeutralForBinding } from '@/engine/registry';
import { WidgetShellHeader } from './WidgetShellHeader';
import { RefineInput } from './RefineInput';
import { WhyPopover } from './WhyPopover';
import { BindingRow } from '@/components/widget/BindingRow';
import { HslWidgetBody, isHslWidget } from './HslWidgetBody';
import { LevelsWidgetBody, isFullLevelsWidget } from './LevelsWidgetBody';
import { CurvesWidgetBody, isCurvesWidget, isCurveBinding } from './CurvesWidgetBody';
import { CompoundWidgetBody } from './CompoundWidgetBody';
import { GenfillWidgetBody } from './GenfillWidgetBody';
import { WidgetAutoButton } from './WidgetAutoButton';
import { WidgetHistoryStepper } from './WidgetHistoryStepper';
import { loadRegistry } from '@/lib/registry/loader';
import { maskMatchesImageNode } from '@/lib/mask-filters';

/**
 * Minimum WidgetShell width in CSS pixels. The shell grows past this to fit
 * its content when expanded.
 */
export const WIDGET_SHELL_MIN_WIDTH = 226;

// Fixed width for collapsed pill state. Matches WIDGET_SHELL_MIN_WIDTH so
// transitioning collapsed → expanded doesn't change horizontal footprint.
// Long titles truncate with ellipsis (.widget-title-ellipsis utility).
export const WIDGET_COLLAPSED_WIDTH = 226;

// Genfill widgets render two side-by-side before/after previews, so they need a
// wider expanded floor than the shared default. Collapsed pill is unchanged.
export const GENFILL_MIN_WIDTH = 420;

interface WidgetShellProps {
  widget: Widget;
  selected?: boolean;
}

const EMPTY_MASKS: MaskSummary[] = [];

export function WidgetShell({ widget, selected = false }: WidgetShellProps) {
  const { isExpanded, toggle } = useWidgetExpansion(widget.id);
  const { hoveredWidgetId, setHoveredWidget } = useHoveredWidget();
  const sessionId = useBackendState((s) => s.sessionId);
  // Subscribe to ONLY this widget's optimistic entries (keyed by canonical
  // op-graph node id — see canonIdFor below). The optimistic map's identity
  // changes on every slider tick of ANY widget; subscribing to the whole map
  // re-rendered every shell on the canvas per tick. `useShallow` keeps the
  // returned record stable-by-value, so an unrelated widget's edit — which
  // leaves this widget's patch refs untouched — no longer re-renders this shell.
  const scopedOptimistic = useBackendState(
    useShallow((s) => {
      const out: Record<string, OptimisticPatch> = {};
      for (const b of widget.bindings) {
        const node = widget.nodes.find((n) => n.id === b.target.nodeId);
        const key = node ? `canon:${node.layerId}:${node.type}` : b.target.nodeId;
        const patch = s.optimistic.get(key);
        if (patch) out[key] = patch;
      }
      return out;
    }),
  );
  const allMasks = useBackendState((s) => s.snapshot?.masksIndex ?? EMPTY_MASKS);
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  // Soft filter: hide masks scoped to a different ImageNode. Legacy / global
  // masks (no imageNodeId) remain visible.
  const masks = useMemo(
    () => allMasks.filter((m) => maskMatchesImageNode(m, activeImageNodeId)),
    [allMasks, activeImageNodeId],
  );
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const touched = useEditorStore((s) => s.touchedParams);

  const hidden = useEditorStore((s) => s.hiddenWidgetIds.has(widget.id));
  const toggleHidden = useEditorStore((s) => s.toggleWidgetHidden);
  // When the user pinned a single slider, only that binding key is shown on
  // the canvas. The widget's other bindings still exist (the inspector still
  // edits them) — this is a per-shell display filter.
  const pinnedParamKeys = useEditorStore((s) => s.pinnedWidgetParams[widget.id]);
  const visibleBindings = pinnedParamKeys && pinnedParamKeys.length > 0
    ? widget.bindings.filter((b) => pinnedParamKeys.includes(b.paramKey))
    : widget.bindings;

  const showAiAffordances = widget.origin.kind !== 'tool_invoked';

  // A widget renders the flat BindingRow list (as opposed to a rich body:
  // compound / HSL rail / Levels histogram / Curves editor). The mechanical
  // "Auto" pill is only meaningful for these, and only when unpinned — the
  // recipe writes every binding, not a single-param subset.
  const usesFlatBody =
    !loadRegistry().ops[widget.opId ?? '']?.compound &&
    !isHslWidget(widget) &&
    !isFullLevelsWidget(widget) &&
    !isCurvesWidget(widget);
  const showAuto = !pinnedParamKeys && usesFlatBody;

  const [whyOpen, setWhyOpen] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [refinePending, setRefinePending] = useState(false);

  const mountedRef = useRef(true);
  // Coalesce backend writes per (widget, paramKey). The optimistic patch in
  // setParam below makes the slider feel instant; the backend POST is
  // debounced so a drag (60–120 ticks/s) doesn't flood
  // /api/tools/set_widget_param and trip the 30/min rate limiter.
  const setParamTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Re-arm `mountedRef` on every mount. Without this, React 19 StrictMode's
  // simulated unmount/remount in dev sets the ref to false during the
  // synthetic cleanup, and the `useRef(true)` seed only runs on first render —
  // so for the rest of the component's life every debounced set_widget_param
  // fires `SKIPPED — unmounted` and the slider's live value never reaches the
  // backend, leaving canonical at the binding default.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of setParamTimersRef.current.values()) clearTimeout(timer);
      setParamTimersRef.current.clear();
    };
  }, []);

  const hovered = hoveredWidgetId === widget.id;

  // Optimistic patches are keyed by the CANONICAL op-graph node id
  // (`canon:<layer>:<op>`) — that's what `useImageNodeRender` reads from
  // when applying overrides to op_graph nodes. The widget's own node id
  // (`n_<hex>`) never appears in the canonical graph, so keying by it
  // would correctly bump the slider position in JS state but leave the
  // rendered pixels waiting for the SSE roundtrip — felt laggy.
  function canonIdFor(b: Widget['bindings'][number]): string {
    const node = widget.nodes.find((n) => n.id === b.target.nodeId);
    return node ? `canon:${node.layerId}:${node.type}` : b.target.nodeId;
  }

  // Every canonical node a binding drives — one per layer in the node's
  // replicate set (`layerIds ?? [layerId]`), not just the frozen singular
  // `layerId`. A widget tethered to (or node-scoped over) several layers commits
  // its edit to all of them, so the live optimistic override must cover all of
  // them too; keying only the frozen layer left the other target layers
  // un-previewed until the SSE roundtrip landed. Mirrors widgetTargetLayerIds().
  function canonIdsFor(b: Widget['bindings'][number]): string[] {
    const node = widget.nodes.find((n) => n.id === b.target.nodeId);
    if (!node) return [b.target.nodeId];
    const layerIds = node.layerIds ?? (node.layerId ? [node.layerId] : []);
    return layerIds.length > 0
      ? layerIds.map((lid) => `canon:${lid}:${node.type}`)
      : [canonIdFor(b)];
  }
  function readOptimistic(b: Widget['bindings'][number]): Widget['bindings'][number]['value'] | undefined {
    const patch = scopedOptimistic[canonIdFor(b)];
    if (!patch) return undefined;
    const p = patch.bindings.find((p) => p.paramKey === b.target.paramKey);
    return p?.value;
  }

  // dirty: any binding diverges from default (optimistic-aware)
  const dirty = widget.bindings.some((b) => {
    const opt = readOptimistic(b);
    const effective = opt !== undefined ? opt : b.value;
    return effective !== b.default;
  });

  function setParam(paramKey: string, value: Widget['bindings'][number]['value']) {
    if (!sessionId || offline) return;
    const binding = widget.bindings.find((b) => b.paramKey === paramKey);
    if (binding) {
      const baseRevision = useBackendState.getState().snapshot?.revision ?? 0;
      // Key the optimistic patch by canonical id so the WebGL render pass picks
      // it up immediately — and write one per target layer so a multi-layer
      // widget previews live on every layer it edits, not just the frozen one.
      const patch = {
        bindings: [{ paramKey: binding.target.paramKey, value }],
        baseRevision,
      };
      for (const canonId of canonIdsFor(binding)) {
        useBackendState.getState().applyOptimistic(canonId, patch);
      }
      const node = widget.nodes.find((n) => n.id === binding.target.nodeId);
      if (node?.layerId) {
        useEditorStore.getState().markParamTouched(touchKey(node.layerId, node.type, binding.target.paramKey));
      }
    }
    // Debounce backend writes per paramKey so the optimistic UI stays
    // instant but the network sees one POST per ~100ms of dragging
    // instead of one per pointer-move tick. Always sends the LATEST value.
    const existing = setParamTimersRef.current.get(paramKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setParamTimersRef.current.delete(paramKey);
      if (!mountedRef.current) return;
      void backendTools.set_widget_param(sessionId, { widgetId: widget.id, paramKey, value });
    }, 100);
    setParamTimersRef.current.set(paramKey, timer);
  }

  async function handleApply() {
    if (!sessionId || offline) return;
    // Flush any pending debounced set_widget_param timers BEFORE accept so
    // the backend's binding.value reflects the just-dragged slider position.
    // accept_widget walks bindings to write canonical — if a timer is still
    // queued, accept reads the stale binding.value and rolls the live edit
    // back the moment the optimistic patch clears.
    const pendingKeys = Array.from(setParamTimersRef.current.keys());
    if (pendingKeys.length > 0) {
      const optMap = useBackendState.getState().optimistic;
      await Promise.all(
        pendingKeys.map((paramKey) => {
          const timer = setParamTimersRef.current.get(paramKey);
          if (timer) clearTimeout(timer);
          setParamTimersRef.current.delete(paramKey);
          const binding = widget.bindings.find((b) => b.paramKey === paramKey);
          if (!binding) return Promise.resolve();
          // Read the latest optimistic value (if any) — that's the live slider
          // position. Falls back to binding.value otherwise. Look across ALL of
          // the binding's target-layer keys (canonIdsFor mirrors setParam's
          // fan-out); a multi-layer widget whose frozen layerId isn't in the
          // replicate set would otherwise miss and send stale binding.value.
          const live = canonIdsFor(binding)
            .map((id) => optMap.get(id))
            .find((patch) => patch !== undefined)
            ?.bindings.find((p) => p.paramKey === binding.target.paramKey)?.value;
          const value = live !== undefined ? live : binding.value;
          return backendTools.set_widget_param(sessionId, {
            widgetId: widget.id, paramKey, value,
          });
        }),
      );
    }
    logWidgetUndoDiag('apply(accept_widget)', { widgetId: widget.id });
    void backendTools.accept_widget(sessionId, { widgetId: widget.id });
  }

  function handleClose() {
    if (!sessionId || offline) return;
    void backendTools.delete_widget(sessionId, { widgetId: widget.id, suppressSimilar: false });
  }

  function handleReset() {
    for (const b of widget.bindings) setParam(b.paramKey, b.default);
  }

  function handleRefineSubmit(instruction: string) {
    if (!sessionId || offline) return;
    setRefinePending(true);
    void backendTools
      .refine_widget(sessionId, { widgetId: widget.id, instruction, edits: [], additions: [] })
      .finally(() => {
        if (!mountedRef.current) return;
        setRefinePending(false);
        setRefineOpen(false);
      });
  }

  function effectiveValue(b: Widget['bindings'][number]) {
    const opt = readOptimistic(b);
    return opt !== undefined ? opt : b.value;
  }

  // One row renderer, shared by the flat body and by the non-curve "extras" a
  // curves widget can carry (e.g. teal_orange's saturation slider next to its
  // curve). Keeps provenance + mask wiring in one place.
  const renderBindingRow = (b: Widget['bindings'][number]) => {
    const eff = effectiveValue(b);
    const node = widget.nodes.find((n) => n.id === b.target.nodeId);
    const isTouched = node?.layerId
      ? touched.has(touchKey(node.layerId, node.type, b.target.paramKey))
      : false;
    // Engine neutral feeds the provenance check so an AI slider reads VIOLET
    // while still resting at the AI's resolved value (= binding.default, ≠
    // engine 0). User touch flips it to ACCENT (blue).
    const neutral = engineNeutralForBinding(b);
    return (
      <BindingRow
        // A multi-op widget can carry two bindings with the same user paramKey
        // (e.g. both ops expose "amount"). Key by the binding's unique target
        // (node + node-param) so React keeps them distinct.
        key={`${b.target.nodeId}:${b.target.paramKey}`}
        binding={b}
        effectiveValue={eff}
        maskSummaries={masks}
        onChange={(value) => setParam(b.paramKey, value)}
        provenance={bindingProvenance(
          eff,
          b.default,
          widget.origin.kind !== 'tool_invoked',
          isTouched,
          neutral,
        )}
      />
    );
  };

  // Non-curve bindings on a curves widget (teal_orange = curve + saturation).
  // Rendered as plain rows under the curve editor so they aren't dropped.
  const curvesExtraBindings = widget.bindings.filter((b) => !isCurveBinding(b));

  return (
    <div
      // Collapsed: fixed 226px pill (WIDGET_COLLAPSED_WIDTH) — no stretching for long titles.
      // Expanded: min-width only, body grows to fit controls.
      // AI-composed widgets get a violet outline + glow (widget-shell-ai) so
      // they read as distinct from tool-invoked widgets on the canvas.
      className={`overlay w-fit ${showAiAffordances ? 'widget-shell-ai' : ''} ${selected && !showAiAffordances ? 'workspace-node-selected' : ''} ${hovered ? 'border-accent' : ''} ${hidden ? 'opacity-60' : ''}`}
      style={
        isExpanded
          ? { minWidth: `${widget.genfill ? GENFILL_MIN_WIDTH : WIDGET_SHELL_MIN_WIDTH}px` }
          : { width: `${WIDGET_COLLAPSED_WIDTH}px` }
      }
      onMouseEnter={() => setHoveredWidget(widget.id)}
      onMouseLeave={() => setHoveredWidget(null)}
    >
      <WidgetShellHeader
        widget={widget}
        expanded={isExpanded}
        dirty={dirty}
        hidden={hidden}
        onToggle={toggle}
        onClose={handleClose}
        onToggleHidden={() => toggleHidden(widget.id)}
        onRefine={() => setRefineOpen((v) => !v)}
        onWhy={() => setWhyOpen((v) => !v)}
        onApply={handleApply}
        applyDisabled={offline}
        showAiAffordances={showAiAffordances}
        suppressDecision={!!widget.genfill}
        whyButton={
          <WhyPopover open={whyOpen} widget={widget} onOpenChange={setWhyOpen}>
            <button
              type="button"
              aria-label="Explain widget"
              title="Why? — explain this widget's reasoning"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center justify-center size-4 rounded-[3px]
                text-text-secondary hover:text-text-primary hover:bg-surface-secondary transition-colors"
            >
              <span aria-hidden className="inline-block leading-none font-semibold text-[12px] -mt-px">
                ?
              </span>
            </button>
          </WhyPopover>
        }
      />
      {isExpanded && widget.genfill && <GenfillWidgetBody widget={widget} />}
      {isExpanded && !widget.genfill && (
        <>
          {/* Per-widget history stepper — ‹ n/N › walks this widget's timeline,
              restoring each step (synced to global history). Renders nothing
              until the widget has history. */}
          <WidgetHistoryStepper
            widgetId={widget.id}
            onReset={handleReset}
            autoSlot={
              showAuto ? (
                <WidgetAutoButton widget={widget} setParam={(k, v) => setParam(k, v)} />
              ) : undefined
            }
          />
          {/* Inline reasoning banner removed — the footer's "Why?" button
              already exposes the same string in a popover. */}
          {/* When a single-param pin filter is active, fall through to the
              flat BindingRow list regardless of widget shape — the rich
              bodies (HSL band rail, Levels histogram, Curves editor) expect
              all bindings to be present, so they're skipped here. */}
          {!pinnedParamKeys && loadRegistry().ops[widget.opId ?? '']?.compound && (
            <div className="px-1.5 py-1">
              <CompoundWidgetBody widget={widget} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isHslWidget(widget) && (
            <div className="px-1.5 py-1">
              <HslWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isFullLevelsWidget(widget) && (
            <div className="px-1.5 py-1">
              <LevelsWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
            </div>
          )}
          {!pinnedParamKeys && widget.bindings.length > 0 && isCurvesWidget(widget) && (
            <div className="py-1">
              <CurvesWidgetBody widget={widget} effectiveValue={effectiveValue} setParam={setParam} />
              {/* Non-curve bindings (e.g. teal_orange's saturation slider) that
                  the curve body doesn't draw — render them as rows so they
                  aren't silently dropped. */}
              {curvesExtraBindings.length > 0 && (
                <div className="flex flex-col gap-1.5 px-1.5 pt-1">
                  {curvesExtraBindings.map(renderBindingRow)}
                </div>
              )}
            </div>
          )}
          {widget.bindings.length > 0 && (pinnedParamKeys || usesFlatBody) && (
            <div className="flex flex-col gap-1.5 px-1.5 py-1">
              {/* Auto pill lives on the action strip above (autoSlot), not here. */}
              {visibleBindings.map(renderBindingRow)}
            </div>
          )}
          {refineOpen && (
            <RefineInput
              onSubmit={handleRefineSubmit}
              onCancel={() => setRefineOpen(false)}
              pending={refinePending}
            />
          )}
        </>
      )}
    </div>
  );
}
