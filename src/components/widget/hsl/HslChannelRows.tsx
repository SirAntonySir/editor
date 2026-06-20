import { Fragment } from 'react';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { HSL_BANDS, hueTrack, satTrack, lumTrack, type HslBand } from '@/components/widget/hsl/hsl-bands';
import type { RenderSlider } from '@/components/widget/hsl/HslBandSliders';

export type HslChannel = 'hue' | 'sat' | 'lum';

const TRACK: Record<HslChannel, (centerHue: number) => string> = {
  hue: hueTrack,
  sat: satTrack,
  lum: lumTrack,
};

const CHANNEL_OPTS: SegmentedOption<HslChannel>[] = [
  { value: 'hue', label: 'Hue' },
  { value: 'sat', label: 'Sat' },
  { value: 'lum', label: 'Lum' },
];

interface HslChannelRowsProps {
  channel: HslChannel;
  onChannelChange: (channel: HslChannel) => void;
  renderSlider: RenderSlider;
  /** Optional subset of bands to render. Defaults to all 8 bands. */
  bands?: readonly HslBand[];
}

/** By-channel body: a channel tab strip + one colour-track row per band. */
export function HslChannelRows({ channel, onChannelChange, renderSlider, bands }: HslChannelRowsProps) {
  const visible = bands ?? HSL_BANDS;
  return (
    <div className="flex flex-col gap-3">
      <Segmented options={CHANNEL_OPTS} value={channel} onChange={onChannelChange} aria-label="HSL channel" />
      <div className="flex flex-col gap-2.5">
        {visible.map((b) => (
          <Fragment key={b.key}>{renderSlider(`${b.key}_${channel}`, b.label, TRACK[channel](b.centerHue))}</Fragment>
        ))}
      </div>
    </div>
  );
}
