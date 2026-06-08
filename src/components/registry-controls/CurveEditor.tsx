import { CurveEditor as CurveEditorPrimitive } from '@/components/inspector/widget/primitives/CurveEditor';
import { IDENTITY_CURVES } from '@/types/widget';
import type { CurvesValue, CurvePoint } from '@/types/widget';
import type { RegistryControlProps } from './Slider';

/**
 * CurveEditor — handles `curve_points` params.
 *
 * The registry `curve_points` param stores a flat `[[x, y], ...]` array
 * representing the RGB channel. The underlying CurveEditorPrimitive takes a
 * full four-channel `CurvesValue`. This adapter bridges the two formats:
 * the RGB channel is driven by the param value; the other channels stay at
 * identity and changes to them are projected back into the RGB channel only.
 *
 * TODO: Support multi-channel curve_points params (e.g. separate R/G/B keys).
 *       For now a single `curve_points` param drives the RGB master channel.
 */

type XYPair = [number, number];

function isXYPairArray(v: unknown): v is XYPair[] {
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.every((pt) => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number' && typeof pt[1] === 'number')
  );
}

function toXYPairs(pts: CurvePoint[]): XYPair[] {
  return pts.map((p) => [p.x, p.y]);
}

function toCurvePoints(pairs: XYPair[]): CurvePoint[] {
  return pairs.map(([x, y]) => ({ x, y }));
}

export function CurveEditor({ schema, value, onChange, label, disabled }: RegistryControlProps) {
  void schema; // min_points / max_points not yet enforced in v1
  const pairs: XYPair[] = isXYPairArray(value) ? value : toXYPairs(IDENTITY_CURVES.rgb);

  const curvesValue: CurvesValue = {
    rgb: toCurvePoints(pairs),
    red: [...IDENTITY_CURVES.red],
    green: [...IDENTITY_CURVES.green],
    blue: [...IDENTITY_CURVES.blue],
  };

  function handleChange(next: CurvesValue) {
    // Project RGB channel back to [[x,y],...] format
    onChange(toXYPairs(next.rgb));
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-40' : undefined}>
      <span className="text-[10px] text-text-secondary px-1.5">{label}</span>
      <CurveEditorPrimitive value={curvesValue} onChange={handleChange} />
    </div>
  );
}
