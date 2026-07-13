import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import type { Widget, ControlBinding } from '@/types/widget';
import type { Anchor } from '@/lib/perceptual-dial/types';
import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import { FusedOpBody } from './FusedOpBody';
import { interpolateExtended } from '@/lib/perceptual-dial/interpolate';
import { sliceWidgetByOp } from '@/lib/widget-slices';
import { useShallow } from 'zustand/react/shallow';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';
import { breakOutFusedOp } from '@/lib/fused-breakout';
import { strandColorVarForCategory } from '@/lib/tether-strands';

// ---------------------------------------------------------------------------
// FusedPinButton — module-scope to avoid inline component definition.
// Renders a small accent-coloured Pin button for pinned params inside a
// fused op section. Returns null for unpinned params.
// ---------------------------------------------------------------------------
export interface FusedPinButtonProps {
  widgetId: string;
  paramKey: string;
  isPinned: boolean;
}

export function FusedPinButton({ widgetId, paramKey, isPinned }: FusedPinButtonProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');

  if (!isPinned) return null;

  const handleClick = () => {
    if (!sessionId || offline) return;
    void backendTools.unlock_widget_param(sessionId, { widgetId, paramKey });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!sessionId || offline}
      title="Pinned — click to release"
      aria-label="Pinned — click to release"
      className="inline-flex items-center text-accent
        hover:text-accent/70 p-0.5 rounded-sm
        disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
    >
      <Pin size={10} aria-hidden />
    </button>
  );
}

/** Clamp a number to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Return the clamped value for a binding if its controlSchema carries a numeric range,
 *  otherwise return v unchanged. Applies to slider, kelvin_strip, and tint_strip. */
function clampToSchema(v: number, b: ControlBinding): number {
  const cs = b.controlSchema;
  if (
    cs.controlType === 'slider' ||
    cs.controlType === 'kelvin_strip' ||
    cs.controlType === 'tint_strip'
  ) {
    return clamp(v, cs.min, cs.max);
  }
  return v;
}

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
  /** The full parent widget — forwarded to FusedOpBody for the sliced view. */
  widget: Widget;
  /** The op-slice this section renders. */
  slice: import('@/lib/widget-slices').OpSlice;
  /** Optimistic-aware value reader from the parent WidgetShell. */
  effectiveValue: (binding: ControlBinding) => ControlBinding['value'];
  /** Write a param via the parent widget path. */
  setParam: (paramKey: string, value: ControlBinding['value']) => void;
  disabled?: boolean;
  pinnedCount: number;
  /** The widget ID — forwarded to FusedPinButton for unlock calls. */
  widgetId: string;
  /** Set of paramKeys that are currently pinned in this section. */
  lockedParamKeys: Set<string>;
  /** Called when the user clicks the section-header "release all" button. */
  onReleaseAll: () => void;
  /** Break this op out onto the canvas as a projection satellite (⤢). */
  onBreakOut: () => void;
  /** True when a satellite for this op already exists — the ⤢ focuses it. */
  brokenOut: boolean;
}

/** Collapsible section for one op within a fused widget. */
function FusedOpSection({
  widget,
  slice,
  effectiveValue,
  setParam,
  disabled,
  pinnedCount,
  widgetId,
  lockedParamKeys,
  onReleaseAll,
  onBreakOut,
  brokenOut,
}: FusedOpSectionProps) {
  const [open, setOpen] = useState(false);
  const op = slice.op;

  return (
    <div className="border-t border-separator/50 first:border-t-0">
      {/* Header row: collapse button + sibling release-all pin button.
          button-in-button is invalid HTML, so the pin control is a sibling
          element sitting after the collapse <button>. */}
      <div className="flex items-center w-full">
        <button
          type="button"
          className="flex items-center gap-1.5 flex-1 min-w-0 px-2.5 py-1.5 text-left text-[10px] text-text-secondary hover:text-text-primary transition-colors select-none"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )}
          {/* Category swatch — same token the braided strand reads, so card and
              canvas can never drift on colour. */}
          <span
            className="size-[7px] shrink-0 rounded-sm"
            data-strand-swatch={op.category ?? 'default'}
            style={{ background: strandColorVarForCategory(op.category) }}
            aria-hidden
          />
          <span className="truncate">{op.display_name}</span>
        </button>
        <button
          type="button"
          className={`inline-flex items-center px-1.5 py-1.5 text-[10px] transition-colors select-none shrink-0 ${
            brokenOut ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={brokenOut ? 'On canvas — pinned as widget' : 'Open as widget on canvas'}
          aria-label={brokenOut ? 'On canvas — pinned as widget' : 'Open as widget on canvas'}
          aria-pressed={brokenOut}
          onClick={onBreakOut}
        >
          {/* The sidebar's pin-to-canvas glyph in BOTH states (mirrors
              ToolSection's "Pin to canvas"): outline = available, filled
              accent = already on canvas. */}
          <Pin
            className="size-2.5 shrink-0"
            fill={brokenOut ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
        {pinnedCount > 0 && (
          <button
            type="button"
            className="flex items-center gap-0.5 px-2 py-1.5 text-[10px] text-text-secondary hover:text-accent transition-colors select-none shrink-0"
            title={`${pinnedCount} pinned — click to release all`}
            aria-label={`${pinnedCount} pinned — click to release all`}
            onClick={onReleaseAll}
          >
            <Pin className="size-2.5 shrink-0" />
            <span>{pinnedCount}</span>
          </button>
        )}
      </div>
      {open && (
        <FusedOpBody
          parentWidget={widget}
          slice={slice}
          effectiveValue={effectiveValue}
          setParam={setParam}
          disabled={disabled}
          renderPinSlot={(paramKey) => (
            <FusedPinButton
              widgetId={widgetId}
              paramKey={paramKey}
              isPinned={lockedParamKeys.has(paramKey)}
            />
          )}
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
 * stays live across all op sections.
 */
export function FusedWidgetBody({ widget, effectiveValue, setParam }: FusedWidgetBodyProps) {
  const compound = widget.compound;

  const sessionId = useBackendState((s) => s.sessionId);
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  // Which op nodes already have a break-out satellite (so the ⤢ reads
  // "broken out" and re-clicking focuses instead of duplicating).
  const sliceNodeIds = useEditorStore(
    useShallow((s) => new Set(Object.values(s.fusedSliceNodes).map((n) => n.nodeId))),
  );

  // Driver t in [0, 1.5]: driverValue from the snapshot, default 1.0 (= 100).
  const initialT = (widget.driverValue != null ? widget.driverValue : 1.0);
  const [driverT, setDriverT] = useState<number>(initialT);

  // Ref to stabilise the timer map across renders without re-creating callbacks.
  const driverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 1: Clear the debounce timer on unmount to avoid state updates after unmount.
  useEffect(() => () => {
    if (driverTimerRef.current) clearTimeout(driverTimerRef.current);
  }, []);

  // Fix 6: Sync driver state to SSoT when widget.driverValue changes from the backend.
  useEffect(() => {
    setDriverT(widget.driverValue ?? 1);
  }, [widget.driverValue]);

  const slices = sliceWidgetByOp(widget);

  // Fix 3: Build locked set to skip locked params in optimistic patch.
  const lockedSet = useMemo(() => new Set(widget.lockedParams ?? []), [widget.lockedParams]);

  // NOTE: interpolated values at current t are now only used by handleDriverChange
  // for the optimistic patch per-slice.  The per-op sections read through effectiveValue
  // directly (via FusedOpBody) so there is no shared top-level `interpolated` map here.

  const handleDriverChange = useCallback((displayVal: number) => {
    const t = displayVal / 100;
    setDriverT(t);

    // Optimistic: patch each op node so the WebGL render shows live preview.
    const snapshot = useBackendState.getState().snapshot;
    if (!snapshot) return;
    const baseRevision = snapshot.revision;

    for (const slice of slices) {
      const node = widget.nodes.find((n) => n.id === slice.nodeId);
      if (!node) continue;

      // Fix 4: Write to EVERY layer in node.layerIds ?? [node.layerId], not just node.layerId.
      const targetLayerIds = node.layerIds ?? (node.layerId ? [node.layerId] : []);
      if (targetLayerIds.length === 0) continue;

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
      const opInterpolated = interpolateExtended(opAnchors, t, compound?.interpolation ?? 'catmull_rom_1d');
      // Fix 3: Filter out locked params from the optimistic bindings.
      // Fix 1: Clamp each value to its binding's controlSchema range before applyOptimistic.
      const bindings = Object.entries(opInterpolated)
        .filter(([k]) => sliceParamKeys.has(k) && !lockedSet.has(k))
        .map(([paramKey, value]) => {
          const binding = slice.bindings.find((b) => b.target.paramKey === paramKey);
          const clamped = (binding !== undefined && typeof value === 'number')
            ? clampToSchema(value, binding)
            : value;
          return { paramKey, value: clamped };
        });

      if (bindings.length > 0) {
        // Fix 4: Apply optimistic patch for each target layer.
        for (const layerId of targetLayerIds) {
          useBackendState.getState().applyOptimistic(
            `canon:${layerId}:${node.type}`,
            { bindings, baseRevision },
          );
        }
      }
    }

    // Debounce: send driver value to backend via __driver paramKey.
    if (driverTimerRef.current) clearTimeout(driverTimerRef.current);
    driverTimerRef.current = setTimeout(() => {
      setParam('__driver', t);
    }, 100);
  }, [slices, widget.nodes, compound, setParam, lockedSet]);

  if (!compound) return null;

  // Fix 2: Label fallback must be 'Intensity', not 'Strength'.
  const driverLabel = compound.label ?? 'Intensity';
  // backend stores t∈[0, DRIVER_MAX=1.5] (fused_compound.py); UI renders ×100, proposal at 100
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
          // Collect pinned paramKeys for this section's bindings.
          const sectionLockedKeys = new Set(
            slice.bindings
              .filter((b) => lockedSet.has(b.target.paramKey))
              .map((b) => b.target.paramKey),
          );
          const pinnedCount = sectionLockedKeys.size;

          // unlock_widget_param keys on BARE paramKey (widget-wide namespace) —
          // if two op sections share a param key, releasing here unlocks both.
          // Schema limitation, same as set_widget_param's implicit lock.
          const handleReleaseAll = () => {
            if (!sessionId || offline) return;
            for (const paramKey of sectionLockedKeys) {
              void backendTools.unlock_widget_param(sessionId, { widgetId: widget.id, paramKey });
            }
          };

          const brokenOut = sliceNodeIds.has(slice.nodeId);
          const handleBreakOut = () => {
            breakOutFusedOp(widget.id, slice.nodeId);
          };

          return (
            <FusedOpSection
              key={slice.nodeId}
              widget={widget}
              slice={slice}
              effectiveValue={effectiveValue}
              setParam={setParam}
              pinnedCount={pinnedCount}
              widgetId={widget.id}
              lockedParamKeys={sectionLockedKeys}
              onReleaseAll={handleReleaseAll}
              onBreakOut={handleBreakOut}
              brokenOut={brokenOut}
            />
          );
        })}
      </div>
    </div>
  );
}
