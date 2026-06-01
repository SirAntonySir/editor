import { Fragment } from 'react';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { HSL_BANDS, hueTrack, satTrack, lumTrack } from './hsl-bands';
import type { RenderSlider } from './HslBandSliders';

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
}

/** By-channel body: a channel tab strip + one colour-track row per band. */
export function HslChannelRows({ channel, onChannelChange, renderSlider }: HslChannelRowsProps) {
  return (
    <div className="flex flex-col gap-3">
      <Segmented options={CHANNEL_OPTS} value={channel} onChange={onChannelChange} aria-label="HSL channel" />
      <div className="flex flex-col gap-2.5">
        {HSL_BANDS.map((b) => (
          <Fragment key={b.key}>{renderSlider(`${b.key}_${channel}`, b.label, TRACK[channel](b.centerHue))}</Fragment>
        ))}
      </div>
    </div>
  );
}
