import { useMemo } from 'react';
import { CurveControl } from '@/components/inspector/widget/primitives/CurveControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { IDENTITY_CURVES, type CurvesValue, type CurvePoint } from '@/types/curve';
import type { ControlValue } from '@/types/widget';

interface CurvesSectionBodyProps { layerId: string; }

type XYPair = [number, number];
type Channel = keyof CurvesValue;

const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];
const IDENTITY_PAIRS: XYPair[] = [[0, 0], [255, 255]];

/** `XYPair[]` doesn't fit the ControlValue type union (which is the wire
 *  format for `set_param`), but the registry's canonical curves params are
 *  arrays at runtime. CurvesWidgetBody bridges this with `as unknown as
 *  ControlValue` casts; we use the same trick at the hook boundary so the
 *  rest of the body stays strongly typed in `XYPair[]`. */
type PairsControlValue = ControlValue;

/**
 * Inspector section body for curves.
 *
 * Writes four per-channel canonical params (`rgb`, `red`, `green`, `blue`)
 * with the registry-canonical `[[x, y], ...]` (0-255) shape — same keys
 * `set_widget_param` writes when the user edits a curve on the canvas
 * widget. That alignment is what keeps the sidebar curve editor in sync
 * with the canvas curves widget; previously the sidebar wrote a single
 * `curves` key holding a CurvesValue object, which never overlapped with
 * the widget's per-channel writes on the same canonical node.
 *
 * The CurveControl primitive lives in 0-1 CurvePoint[] space, so we
 * convert at the boundary in both directions.
 */
export function CurvesSectionBody({ layerId }: CurvesSectionBodyProps) {
  // One hook per channel. The hook keys its optimistic patch by node id
  // + param, so four writes to four distinct param keys don't trample
  // each other. We coerce the typed `XYPair[]` boundary through
  // `PairsControlValue` so the hook's generic constraint (ControlValue)
  // is satisfied without losing the local shape.
  const [rgbRaw,   setRgbRaw]   = useCanonicalParam<PairsControlValue>(layerId, 'curves', 'rgb',   IDENTITY_PAIRS as unknown as PairsControlValue);
  const [redRaw,   setRedRaw]   = useCanonicalParam<PairsControlValue>(layerId, 'curves', 'red',   IDENTITY_PAIRS as unknown as PairsControlValue);
  const [greenRaw, setGreenRaw] = useCanonicalParam<PairsControlValue>(layerId, 'curves', 'green', IDENTITY_PAIRS as unknown as PairsControlValue);
  const [blueRaw,  setBlueRaw]  = useCanonicalParam<PairsControlValue>(layerId, 'curves', 'blue',  IDENTITY_PAIRS as unknown as PairsControlValue);
  const rgbPairs   = asPairs(rgbRaw);
  const redPairs   = asPairs(redRaw);
  const greenPairs = asPairs(greenRaw);
  const bluePairs  = asPairs(blueRaw);

  // Project per-channel pairs into the CurvesValue shape the primitive
  // wants. Memoised so identity-stable references propagate when nothing
  // changed — important for the inner editor's diffing.
  const value: CurvesValue = useMemo(() => ({
    rgb:   pairsToPoints(rgbPairs),
    red:   pairsToPoints(redPairs),
    green: pairsToPoints(greenPairs),
    blue:  pairsToPoints(bluePairs),
  }), [rgbPairs, redPairs, greenPairs, bluePairs]);

  const setters: Record<Channel, (pairs: XYPair[]) => void> = {
    rgb:   (p) => setRgbRaw(p   as unknown as PairsControlValue),
    red:   (p) => setRedRaw(p   as unknown as PairsControlValue),
    green: (p) => setGreenRaw(p as unknown as PairsControlValue),
    blue:  (p) => setBlueRaw(p  as unknown as PairsControlValue),
  };
  const current: Record<Channel, XYPair[]> = {
    rgb: rgbPairs, red: redPairs, green: greenPairs, blue: bluePairs,
  };

  function handleChange(next: CurvesValue) {
    // Commit only the channels whose point arrays actually changed —
    // CurveEditor synthesises identity values for the other three, so a
    // blanket write would clobber any edits not represented in `next`.
    for (const ch of CHANNELS) {
      const nextPairs = pointsToPairs(next[ch]);
      if (!arraysEqual(nextPairs, current[ch])) {
        setters[ch](nextPairs);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <CurveControl label="Curves" value={value} onChange={handleChange} />
    </div>
  );
}

// ─── 0-255 ↔ 0-1 conversion (same units the canvas widget uses) ────────

/** Coerce a hook-returned ControlValue into the XYPair[] shape the rest of
 *  the file consumes. Non-array values (e.g. node was set with the legacy
 *  `curves`-object shape) fall through to identity so the editor stays
 *  rendable. */
function asPairs(v: ControlValue): XYPair[] {
  if (Array.isArray(v) && v.length >= 2 && v.every((p) =>
    Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  )) {
    return v as unknown as XYPair[];
  }
  return [...IDENTITY_PAIRS];
}

function pairsToPoints(pairs: XYPair[]): CurvePoint[] {
  if (!Array.isArray(pairs) || pairs.length < 2) return [...IDENTITY_CURVES.rgb];
  return pairs.map(([x, y]) => ({ x: x / 255, y: y / 255 }));
}

function pointsToPairs(pts: CurvePoint[]): XYPair[] {
  return pts.map(({ x, y }) => [x * 255, y * 255]);
}

function arraysEqual(a: XYPair[], b: XYPair[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}
