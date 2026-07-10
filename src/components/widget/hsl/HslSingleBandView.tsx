import type { ReactNode } from 'react';
import { HSL_BANDS } from './hsl-bands';
import { HslBandRail } from './HslBandRail';
import { HslBandSliders, type RenderSlider } from './HslBandSliders';

interface HslSingleBandViewProps {
  band: string;
  renderSlider: RenderSlider;
  /** Whether a band has any non-default param (drives the swatch's edited dot). */
  bandEdited: (band: string) => boolean;
  /** The add-colour swatch, rendered beside the single colour at the same size. */
  addSlot?: ReactNode;
}

/** A focused single-band body: the one colour's swatch + the add-colour swatch,
 *  above that band's three colour sliders. Reset lives on the widget's action
 *  strip, so this body carries none of its own. */
export function HslSingleBandView({ band, renderSlider, bandEdited, addSlot }: HslSingleBandViewProps) {
  const bandMeta = HSL_BANDS.filter((b) => b.key === band);
  return (
    <div className="flex flex-col gap-3">
      <HslBandRail
        activeBand={band}
        onSelect={() => {}}
        bandEdited={bandEdited}
        bands={bandMeta}
        addSlot={addSlot}
      />
      <HslBandSliders band={band} renderSlider={renderSlider} />
    </div>
  );
}
