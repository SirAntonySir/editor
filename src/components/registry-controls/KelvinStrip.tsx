import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import type { RegistryControlProps } from './Slider';

/**
 * KelvinStrip — temperature picker for kelvin `scalar` params.
 *
 * Renders a slider with a warm→cool colour gradient matching the visual
 * appearance of colour temperature (warm amber at low K, cool blue at high K).
 * The range defaults to 2000–12000 K if not specified.
 */

/** Build a warm→cool gradient matching approximate blackbody colours */
function kelvinGradient(): string {
  // Approximate perceptual stops across 2000–12000K
  const stops = [
    'hsl(28 100% 55%)',   // ~2000K — deep amber
    'hsl(38 90% 65%)',    // ~3000K — warm orange
    'hsl(48 70% 80%)',    // ~4500K — neutral warm
    'hsl(210 5% 95%)',    // ~6500K — near-white / daylight
    'hsl(210 50% 75%)',   // ~8000K — cool blue-white
    'hsl(220 70% 65%)',   // ~12000K — sky blue
  ];
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function KelvinStrip({ schema, value, onChange, label, disabled }: RegistryControlProps) {
  if (schema.type !== 'scalar' || !schema.range) {
    throw new Error(`KelvinStrip needs a scalar param with range, got ${schema.type}`);
  }
  const [min, max] = schema.range;
  const numValue = typeof value === 'number' ? value : Number(schema.default);

  return (
    <div aria-disabled={disabled} className={disabled ? 'pointer-events-none opacity-40' : undefined}>
      <AdjustmentSlider
        label={label}
        value={numValue}
        min={min}
        max={max}
        step={schema.unit ? 50 : 1}
        defaultValue={typeof schema.default === 'number' ? schema.default : undefined}
        trackGradient={kelvinGradient()}
        onChange={(v) => onChange(v)}
        formatValue={(v) => `${Math.round(v)}K`}
      />
    </div>
  );
}
