import { useState } from 'react';
import { Segmented, type SegmentedOption } from '@/components/ui/Segmented';
import { HSL_BANDS } from './hsl-bands';
import { HslBandRail } from './HslBandRail';
import { HslBandSliders, type RenderSlider } from './HslBandSliders';
import { HslChannelRows, type HslChannel } from './HslChannelRows';

type View = 'band' | 'channel';

const VIEW_OPTS: SegmentedOption<View>[] = [
  { value: 'band', label: 'By band' },
  { value: 'channel', label: 'By channel' },
];

interface HslPanelViewProps {
  renderSlider: RenderSlider;
  bandEdited: (band: string) => boolean;
  onReset: () => void;
  /**
   * Optional subset of band keys the panel should expose. Defaults to all 8
   * bands. AI-spawned widgets (e.g. complementary-grade preset) pass only the
   * bands they actually bind, so the rail doesn't display dead rows.
   */
  availableBands?: string[];
}

/** Source-agnostic two-view HSL panel. Owns the view/band/channel UI state;
 *  the data binding is injected via `renderSlider` / `bandEdited` / `onReset`. */
export function HslPanelView({ renderSlider, bandEdited, onReset, availableBands }: HslPanelViewProps) {
  const bands = availableBands && availableBands.length > 0
    ? HSL_BANDS.filter((b) => availableBands.includes(b.key))
    : [...HSL_BANDS];
  const [view, setView] = useState<View>('band');
  const [band, setBand] = useState<string>(bands[0]?.key ?? HSL_BANDS[0].key);
  const [channel, setChannel] = useState<HslChannel>('hue');
  // If the active band falls out of `availableBands` (e.g. widget shape
  // changed), snap back to the first available one.
  if (!bands.some((b) => b.key === band) && bands[0]) {
    setBand(bands[0].key);
  }
  const activeLabel = bands.find((b) => b.key === band)?.label ?? '';

  return (
    <div className="flex flex-col gap-3">
      <Segmented options={VIEW_OPTS} value={view} onChange={setView} aria-label="HSL view" />
      {view === 'band' ? (
        <>
          <HslBandRail activeBand={band} onSelect={setBand} bandEdited={bandEdited} bands={bands} />
          <div className="text-[10px] text-text-secondary">
            Editing <span className="text-text-primary font-medium">{activeLabel}</span>
          </div>
          <HslBandSliders band={band} renderSlider={renderSlider} />
        </>
      ) : (
        <HslChannelRows channel={channel} onChannelChange={setChannel} renderSlider={renderSlider} bands={bands} />
      )}
      <HslReset onReset={onReset} />
    </div>
  );
}

/** Shared reset affordance — zeroes all params for the surface. */
export function HslReset({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex justify-end pt-1">
      <button
        type="button"
        onClick={onReset}
        className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary"
      >
        Reset
      </button>
    </div>
  );
}
