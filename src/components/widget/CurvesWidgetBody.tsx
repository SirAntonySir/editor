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

function pointsToPairs(pts: CurvePoint[]): XYPair[] {
  return pts.map(({ x, y }) => [x * 255, y * 255]);
}

function channelLabel(ch: Channel): string {
  return ch === 'rgb' ? 'RGB' : ch.charAt(0).toUpperCase() + ch.slice(1);
}

/** True when the widget's bindings cover the four curves channels (rgb/red/
 *  green/blue) via control_type='curve_editor'. Used by WidgetShell to pick
 *  this custom body over the generic BindingRow grid. */
export function isCurvesWidget(widget: Widget): boolean {
  const channels = new Set<string>();
  for (const b of widget.bindings) {
    if (b.control_schema.control_type !== 'curve_editor') continue;
    channels.add(b.param_key);
  }
  return CHANNELS.every((c) => channels.has(c));
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

export function CurvesWidgetBody({ widget, effectiveValue, setParam }: CurvesWidgetBodyProps) {
  const [layout, setLayout] = useState<Layout>('toggle');

  const bindingByChannel = useMemo(() => {
    const m = new Map<Channel, ControlBinding>();
    for (const b of widget.bindings) {
      if ((CHANNELS as readonly string[]).includes(b.param_key)) {
        m.set(b.param_key as Channel, b);
      }
    }
    return m;
  }, [widget.bindings]);

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
      setParam(b.param_key, pointsToPairs(next[ch]) as unknown as ControlValue);
    }
  }

  // Locked single-channel editor — used by grid + stack.
  function ChannelEditor({ ch }: { ch: Channel }) {
    const b = bindingByChannel.get(ch);
    if (!b) return null;
    const v = effectiveValue(b);
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
          setParam(b.param_key, pointsToPairs(next[ch]) as unknown as ControlValue)
        }
      />
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
              <ChannelEditor ch={ch} />
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
              <ChannelEditor ch={ch} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
