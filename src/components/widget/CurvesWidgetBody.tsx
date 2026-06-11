import { useMemo, useState } from 'react';
import { Square, Grid2x2, AlignJustify } from 'lucide-react';
import type { Widget, ControlBinding, ControlValue, CurvesValue, CurvePoint } from '@/types/widget';
import { IDENTITY_CURVES } from '@/types/widget';
import { CurveEditor } from '@/components/inspector/widget/primitives/CurveEditor';

type Channel = keyof CurvesValue;
const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];

type XYPair = [number, number];

function isXYPairArray(v: unknown): v is XYPair[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((pt) => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number')
  );
}

function pairsToPoints(pairs: XYPair[]): CurvePoint[] {
  return pairs.map(([x, y]) => ({ x: x / 255, y: y / 255 }));
}

/** Same as `pairsToPoints` but the pairs are already in 0..1 space (the
 *  convention `op_graph` Node.params uses for fused-tool `points`). */
function pairsToPoints01(pairs: XYPair[]): CurvePoint[] {
  return pairs.map(([x, y]) => ({ x, y }));
}

function pointsToPairs(pts: CurvePoint[]): XYPair[] {
  return pts.map(({ x, y }) => [x * 255, y * 255]);
}

/** True when every value in a pair-array sits inside 0..1 (with a tiny
 *  epsilon for float slop). Used to detect the fused-tool 0..1 convention
 *  vs the registry 0..255 one — they're distinguishable in practice
 *  because no curve point in 0..1 space ever lands outside [0, 1]. */
function looksLike01Space(pairs: XYPair[]): boolean {
  for (const [x, y] of pairs) {
    if (x < -0.0001 || x > 1.0001) return false;
    if (y < -0.0001 || y > 1.0001) return false;
  }
  return true;
}

/** Resolve curve points from a binding. AI fused tools emit the actual curve
 *  in `widget.nodes[node_id].params.points` (0..1 space — same place the
 *  renderer reads from). The widget's `binding.value` may be empty / a
 *  default-shaped placeholder, so prefer the node params and fall back to
 *  binding.value only when the node lacks them. */
function resolveSingleCurvePoints(
  widget: Widget,
  binding: ControlBinding,
  bindingValue: ControlValue,
): CurvePoint[] {
  // Source of truth #1: the op-graph node the binding targets.
  const node = widget.nodes.find((n) => n.id === binding.target.nodeId);
  const nodeParams = node?.params as Record<string, unknown> | undefined;
  const fromNode = nodeParams?.[binding.target.paramKey];
  if (isXYPairArray(fromNode)) {
    return looksLike01Space(fromNode) ? pairsToPoints01(fromNode) : pairsToPoints(fromNode);
  }
  // Source of truth #2: the binding's own value. Detect unit space from the
  // numbers themselves so we read either convention correctly.
  if (isXYPairArray(bindingValue)) {
    return looksLike01Space(bindingValue) ? pairsToPoints01(bindingValue) : pairsToPoints(bindingValue);
  }
  return [...IDENTITY_CURVES.rgb];
}

function channelLabel(ch: Channel): string {
  return ch === 'rgb' ? 'RGB' : ch.charAt(0).toUpperCase() + ch.slice(1);
}

/** Set of control_types that this body knows how to render. `curve_editor`
 *  is the four-channel registry op (toolrail-spawned). `curve` is the
 *  single-luma form emitted by AI fused tools (teal_orange / sky_recovery /
 *  bw_cinematic / ...). */
const CURVE_CONTROL_TYPES = new Set(['curve', 'curve_editor']);

function curveBindings(widget: Widget): ControlBinding[] {
  return widget.bindings.filter((b) =>
    CURVE_CONTROL_TYPES.has(b.controlSchema.controlType),
  );
}

/** True when the widget should render through CurvesWidgetBody. Two shapes
 *  are accepted:
 *   1) Four bindings with `controlType='curve_editor'` covering rgb/red/
 *      green/blue — the toolrail-spawned form, layout switcher visible.
 *   2) Exactly one binding with `controlType='curve' | 'curve_editor'` —
 *      the AI-composed single-luma form, layout switcher hidden. */
export function isCurvesWidget(widget: Widget): boolean {
  const curves = curveBindings(widget);
  // Four-channel form.
  const channels = new Set(
    curves
      .filter((b) => b.controlSchema.controlType === 'curve_editor')
      .map((b) => b.paramKey),
  );
  if (CHANNELS.every((c) => channels.has(c))) return true;
  // Single-luma form.
  return curves.length === 1;
}

type Layout = 'toggle' | 'grid' | 'stack';

const LAYOUT_BUTTONS: { id: Layout; label: string; Icon: typeof Square }[] = [
  { id: 'toggle', label: 'Single channel with tabs', Icon: Square },
  { id: 'grid',   label: '2×2 grid of channels',     Icon: Grid2x2 },
  { id: 'stack',  label: '4×1 stacked channels',     Icon: AlignJustify },
];

interface CurvesWidgetBodyProps {
  widget: Widget;
  effectiveValue: (binding: ControlBinding) => ControlValue;
  setParam: (paramKey: string, value: ControlValue) => void;
}

/** Locked single-channel curve editor — used by grid + stack layouts.
 *  Hoisted to module scope so it isn't redefined per render. */
interface ChannelEditorProps {
  ch: Channel;
  binding: ControlBinding | undefined;
  effectiveValue: (binding: ControlBinding) => ControlValue;
  setParam: (paramKey: string, value: ControlValue) => void;
}

function ChannelEditor({ ch, binding, effectiveValue, setParam }: ChannelEditorProps) {
  if (!binding) return null;
  const v = effectiveValue(binding);
  const pts: CurvePoint[] = isXYPairArray(v) ? pairsToPoints(v) : [...IDENTITY_CURVES[ch]];
  const channelValue: CurvesValue = {
    rgb:   ch === 'rgb'   ? pts : [...IDENTITY_CURVES.rgb],
    red:   ch === 'red'   ? pts : [...IDENTITY_CURVES.red],
    green: ch === 'green' ? pts : [...IDENTITY_CURVES.green],
    blue:  ch === 'blue'  ? pts : [...IDENTITY_CURVES.blue],
  };
  return (
    <CurveEditor
      value={channelValue}
      channel={ch}
      onChange={(next) =>
        setParam(binding.paramKey, pointsToPairs(next[ch]) as unknown as ControlValue)
      }
    />
  );
}

export function CurvesWidgetBody({ widget, effectiveValue, setParam }: CurvesWidgetBodyProps) {
  const [layout, setLayout] = useState<Layout>('toggle');

  const bindingByChannel = useMemo(() => {
    const m = new Map<Channel, ControlBinding>();
    for (const b of widget.bindings) {
      if ((CHANNELS as readonly string[]).includes(b.paramKey)) {
        m.set(b.paramKey as Channel, b);
      }
    }
    return m;
  }, [widget.bindings]);

  /** AI-composed widgets ship one curve binding (typically `points`/luma).
   *  When the four-channel set isn't present, we fall back to that single
   *  binding and treat it as the rgb channel for display. */
  const singleLumaBinding = useMemo<ControlBinding | null>(() => {
    if (CHANNELS.every((c) => bindingByChannel.has(c))) return null;
    const curves = curveBindings(widget);
    return curves.length === 1 ? curves[0] : null;
  }, [widget, bindingByChannel]);

  // Compose a CurvesValue from all four bindings — feeds Toggle mode, where
  // the unlocked CurveEditor switches channels via its own tab bar.
  const curvesValue: CurvesValue = useMemo(() => {
    const out: CurvesValue = {
      rgb:   [...IDENTITY_CURVES.rgb],
      red:   [...IDENTITY_CURVES.red],
      green: [...IDENTITY_CURVES.green],
      blue:  [...IDENTITY_CURVES.blue],
    };
    for (const ch of CHANNELS) {
      const b = bindingByChannel.get(ch);
      if (!b) continue;
      const v = effectiveValue(b);
      if (isXYPairArray(v)) out[ch] = pairsToPoints(v);
    }
    return out;
  }, [bindingByChannel, effectiveValue]);

  // Toggle mode commits only the channel whose array reference changed.
  function handleToggleChange(next: CurvesValue) {
    for (const ch of CHANNELS) {
      if (next[ch] === curvesValue[ch]) continue;
      const b = bindingByChannel.get(ch);
      if (!b) continue;
      setParam(b.paramKey, pointsToPairs(next[ch]) as unknown as ControlValue);
    }
  }

  // Single-luma form (AI fused tools): render one editor with no channel /
  // layout chrome. The module-scope ChannelEditor above handles the
  // four-channel grid + stack layouts below.
  if (singleLumaBinding) {
    const v = effectiveValue(singleLumaBinding);
    const pts = resolveSingleCurvePoints(widget, singleLumaBinding, v);
    // Detect which unit space the binding round-trips in: if the node's
    // params.points lives in 0..1, we must write back in 0..1 too, otherwise
    // the next render flips the curve back to identity.
    const node = widget.nodes.find((n) => n.id === singleLumaBinding.target.nodeId);
    const nodeParams = node?.params as Record<string, unknown> | undefined;
    const fromNode = nodeParams?.[singleLumaBinding.target.paramKey];
    const write01 =
      (isXYPairArray(fromNode) && looksLike01Space(fromNode)) ||
      (isXYPairArray(v) && looksLike01Space(v));
    const value: CurvesValue = {
      rgb:   pts,
      red:   [...IDENTITY_CURVES.red],
      green: [...IDENTITY_CURVES.green],
      blue:  [...IDENTITY_CURVES.blue],
    };
    return (
      <div className="px-1.5 py-1">
        <CurveEditor
          value={value}
          channel="rgb"
          onChange={(next) => {
            const pairs: XYPair[] = write01
              ? next.rgb.map(({ x, y }) => [x, y])
              : pointsToPairs(next.rgb);
            setParam(singleLumaBinding.paramKey, pairs as unknown as ControlValue);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Layout selector */}
      <div className="flex items-center gap-0.5 px-1.5 pt-1">
        {LAYOUT_BUTTONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setLayout(id)}
            title={label}
            aria-label={label}
            aria-pressed={layout === id}
            className={`inline-flex items-center justify-center p-1 rounded-[3px] ${
              layout === id
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
            }`}
          >
            <Icon size={11} aria-hidden />
          </button>
        ))}
      </div>

      {layout === 'toggle' && (
        <div className="px-1.5 pb-1">
          <CurveEditor value={curvesValue} onChange={handleToggleChange} />
        </div>
      )}

      {layout === 'grid' && (
        <div className="grid grid-cols-2 gap-1 px-1.5 pb-1">
          {CHANNELS.map((ch) => (
            <div key={ch} className="flex flex-col gap-0.5">
              <div className="text-[9px] uppercase tracking-wide text-text-secondary px-1">
                {channelLabel(ch)}
              </div>
              <ChannelEditor
                ch={ch}
                binding={bindingByChannel.get(ch)}
                effectiveValue={effectiveValue}
                setParam={setParam}
              />
            </div>
          ))}
        </div>
      )}

      {layout === 'stack' && (
        <div className="flex flex-col gap-1 px-1.5 pb-1">
          {CHANNELS.map((ch) => (
            <div key={ch} className="flex flex-col gap-0.5">
              <div className="text-[9px] uppercase tracking-wide text-text-secondary px-1">
                {channelLabel(ch)}
              </div>
              <ChannelEditor
                ch={ch}
                binding={bindingByChannel.get(ch)}
                effectiveValue={effectiveValue}
                setParam={setParam}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
