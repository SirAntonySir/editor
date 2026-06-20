import { Fragment, type ReactNode } from 'react';
import { HSL_BANDS, hueTrack, satTrack, lumTrack } from '@/components/widget/hsl/hsl-bands';

/** Renders one HSL param as a colour-track slider. Supplied by each surface
 *  (canonical = inspector, bindings = widget) so the layout stays source-agnostic. */
export type RenderSlider = (param: string, label: string, trackGradient: string) => ReactNode;

const CHANNELS = [
  { key: 'hue', label: 'Hue', track: hueTrack },
  { key: 'sat', label: 'Sat', track: satTrack },
  { key: 'lum', label: 'Lum', track: lumTrack },
] as const;

/** By-band body: the active band's three colour-track sliders. */
export function HslBandSliders({ band, renderSlider }: { band: string; renderSlider: RenderSlider }) {
  const centerHue = HSL_BANDS.find((b) => b.key === band)?.centerHue ?? 0;
  return (
    <div className="flex flex-col gap-2.5">
      {CHANNELS.map((c) => (
        <Fragment key={c.key}>{renderSlider(`${band}_${c.key}`, c.label, c.track(centerHue))}</Fragment>
      ))}
    </div>
  );
}
