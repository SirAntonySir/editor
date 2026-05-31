import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import { useCanonicalParam } from '@/hooks/useCanonicalParam';

const BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
const CHANNELS = [
  { key: 'hue', label: 'Hue' },
  { key: 'sat', label: 'Sat' },
  { key: 'lum', label: 'Lum' },
] as const;

interface BandRowProps { layerId: string; band: string; }

function BandRow({ layerId, band }: BandRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] capitalize text-text-secondary">{band}</span>
      {CHANNELS.map((c) => <HslParam key={c.key} layerId={layerId} band={band} channel={c.key} label={c.label} />)}
    </div>
  );
}

interface HslParamProps { layerId: string; band: string; channel: string; label: string; }

function HslParam({ layerId, band, channel, label }: HslParamProps) {
  const [value, setValue] = useCanonicalParam<number>(layerId, 'hsl', `${band}_${channel}`, 0);
  return (
    <AdjustmentSlider label={label} value={value} min={-100} max={100} defaultValue={0} onChange={setValue} />
  );
}

export function HslSectionBody({ layerId }: { layerId: string }) {
  return (
    <div className="flex flex-col gap-3 px-2.5 py-2">
      {BANDS.map((b) => <BandRow key={b} layerId={layerId} band={b} />)}
    </div>
  );
}
