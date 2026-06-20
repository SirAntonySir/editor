import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import type { RegistryControlProps } from './Slider';

/**
 * HueWheel — hue-degree picker for `color_hsv` or `scalar` params with a
 * 0–360 (or custom) degree range.
 *
 * v1: implemented as a slider with a hue gradient track so the colour meaning
 * is immediately visible. A true circular colour wheel is deferred.
 *
 * TODO: replace with a circular SVG/Canvas hue wheel (polar drag interaction).
 *       The hue-gradient slider is functional but not as intuitive as a wheel.
 */

/** Build the full hue gradient for the slider track */
export function hueGradient(min: number, max: number): string {
  const startDeg = min % 360;
  const steps = 12;
  const stops = Array.from({ length: steps + 1 }, (_, i) => {
    const deg = startDeg + (i / steps) * (max - min);
    return `hsl(${deg} 85% 55%)`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function HueWheel({ schema, value, onChange, label, disabled, pinSlot }: RegistryControlProps) {
  const [min, max] = schema.range ?? [0, 360];
  const numValue = typeof value === 'number' ? value : Number(schema.default);

  return (
    <div aria-disabled={disabled} className={disabled ? 'pointer-events-none opacity-40' : undefined}>
      <AdjustmentSlider
        label={label}
        value={numValue}
        min={min}
        max={max}
        step={1}
        defaultValue={typeof schema.default === 'number' ? schema.default : undefined}
        trackGradient={hueGradient(min, max)}
        onChange={(v) => onChange(v)}
        formatValue={(v) => `${Math.round(v)}°`}
        pinSlot={pinSlot}
      />
    </div>
  );
}
