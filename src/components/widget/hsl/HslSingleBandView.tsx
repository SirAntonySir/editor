import { HslBandSliders, type RenderSlider } from './HslBandSliders';
import { HslReset } from './HslPanelView';

interface HslSingleBandViewProps {
  band: string;
  renderSlider: RenderSlider;
  onReset: () => void;
}

/** A focused single-band body: one locked band's three colour sliders. The
 *  band identity is shown by the host (e.g. the widget header swatch). */
export function HslSingleBandView({ band, renderSlider, onReset }: HslSingleBandViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <HslBandSliders band={band} renderSlider={renderSlider} />
      <HslReset onReset={onReset} />
    </div>
  );
}
