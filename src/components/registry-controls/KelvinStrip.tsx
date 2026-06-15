import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import type { RegistryControlProps } from './Slider';

/**
 * KelvinStrip — temperature picker for kelvin `scalar` params.
 *
 * Renders a slider with a warm→cool colour gradient matching the visual
 * appearance of colour temperature (warm amber at low K, cool blue at high K).
 * The range defaults to 2000–12000 K if not specified.
 */

/** Cool→warm gradient track. Flipped from blackbody-temperature direction so
 *  the slider matches the Lightroom/Photoshop white-balance convention:
 *  blue (cool) on the LEFT, amber (warm) on the RIGHT. The underlying
 *  parameter is still Kelvin (low K = warm light source), so the rendered
 *  position-to-value mapping stays standard. */
export function kelvinGradient(): string {
  // Approximate perceptual stops, written right-to-left in Kelvin terms so
  // the resulting linear-gradient lays them out cool → neutral → warm
  // (left → right of the track).
  const stops = [
    'hsl(220 70% 65%)',   // far left — sky blue (highest K)
    'hsl(210 50% 75%)',
    'hsl(210 5% 95%)',    // mid — daylight neutral
    'hsl(48 70% 80%)',
    'hsl(38 90% 65%)',
    'hsl(28 100% 55%)',   // far right — deep amber (lowest K)
  ];
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function KelvinStrip({ schema, value, onChange, label, disabled, pinSlot }: RegistryControlProps) {
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
        step={schema.step ?? 1}
        defaultValue={typeof schema.default === 'number' ? schema.default : undefined}
        trackGradient={kelvinGradient()}
        onChange={(v) => onChange(v)}
        formatValue={(v) => `${Math.round(v)}K`}
        pinSlot={pinSlot}
      />
    </div>
  );
}
