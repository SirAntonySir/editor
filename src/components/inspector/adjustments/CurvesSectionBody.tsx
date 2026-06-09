import { CurveControl } from '@/components/inspector/widget/primitives/CurveControl';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';
import { IDENTITY_CURVES, type CurvesValue } from '@/types/curve';

interface CurvesSectionBodyProps { layerId: string; }

/**
 * Inspector section body for curves. Mirrors HslSectionBody / LevelsSectionBody —
 * delegates reset to the inner control (CurveEditor renders its own Reset when
 * the curve is non-identity), so there's no section-level Reset button.
 */
export function CurvesSectionBody({ layerId }: CurvesSectionBodyProps) {
  const [value, setValue] = useCanonicalParam<CurvesValue>(layerId, 'curves', 'curves', IDENTITY_CURVES);
  return (
    <div className="flex flex-col gap-2 px-2.5 py-2">
      <CurveControl label="Curves" value={value} onChange={setValue} />
    </div>
  );
}
