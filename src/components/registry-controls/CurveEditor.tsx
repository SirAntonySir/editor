import { CurveEditor as CurveEditorPrimitive } from '@/components/inspector/widget/primitives/CurveEditor';
import { IDENTITY_CURVES } from '@/types/widget';
import type { CurvesValue, CurvePoint } from '@/types/widget';
import type { RegistryControlProps } from './Slider';

/**
 * CurveEditor — handles `curve_points` params for the registry-driven panel.
 *
 * Option A (4 independent bindings): each registry binding (rgb / red / green /
 * blue) maps to its own CurveEditor instance.  The param_key tells us which
 * channel to lock the primitive to, so the channel-switcher tabs are hidden
 * and each control edits exactly one channel.
 *
 * Coordinate-space bridging:
 * - Registry `curve_points` stores points in **0–255 space** (`[[0,0],[255,255]]`).
 * - The CurveEditorPrimitive uses **0–1 space** (`CurvePoint { x, y }`).
 * - We normalise on read (÷255) and denormalise on write (×255).
 *
 * Backward compat: if `param_key` is not one of the four channel names we
 * fall back to the previous behaviour of driving the rgb master channel.
 */

type Channel = 'rgb' | 'red' | 'green' | 'blue';
const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];

type XYPair = [number, number];

function isXYPairArray(v: unknown): v is XYPair[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((pt) => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number')
  );
}

/** Convert registry 0–255 XY pairs to primitive 0–1 CurvePoints. */
function pairsToPoints(pairs: XYPair[]): CurvePoint[] {
  return pairs.map(([x, y]) => ({ x: x / 255, y: y / 255 }));
}

/** Convert primitive 0–1 CurvePoints back to registry 0–255 XY pairs. */
function pointsToPairs(pts: CurvePoint[]): XYPair[] {
  return pts.map(({ x, y }) => [x * 255, y * 255]);
}

function identityPoints(ch: Channel): CurvePoint[] {
  return [...IDENTITY_CURVES[ch]];
}

export function CurveEditor({ schema, value, onChange, label, disabled, paramKey }: RegistryControlProps) {
  void schema; // min_points / max_points not yet enforced in v1

  // Determine which channel this instance is locked to.
  const lockedChannel: Channel = (CHANNELS as string[]).includes(paramKey ?? '')
    ? (paramKey as Channel)
    : 'rgb';

  // `value` arrives as `[[x,y],...]` in 0–255 space.  Normalise to 0–1.
  const pairs: XYPair[] = isXYPairArray(value) ? value : pointsToPairs(identityPoints(lockedChannel));
  const pts: CurvePoint[] = pairsToPoints(pairs);

  // Build a full CurvesValue with the other channels at identity so the
  // primitive's normalisation guard doesn't override our channel.
  const curvesValue: CurvesValue = {
    rgb: lockedChannel === 'rgb' ? pts : identityPoints('rgb'),
    red: lockedChannel === 'red' ? pts : identityPoints('red'),
    green: lockedChannel === 'green' ? pts : identityPoints('green'),
    blue: lockedChannel === 'blue' ? pts : identityPoints('blue'),
  };

  function handleChange(next: CurvesValue) {
    // Project the changed channel back to [[x,y]] 0–255 pairs.
    onChange(pointsToPairs(next[lockedChannel]));
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-40' : undefined}>
      <span className="text-[10px] text-text-secondary px-1.5">{label}</span>
      <CurveEditorPrimitive
        value={curvesValue}
        onChange={handleChange}
        channel={lockedChannel}
      />
    </div>
  );
}
