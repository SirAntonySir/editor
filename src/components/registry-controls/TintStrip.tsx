import { AdjustmentSlider } from '@/components/ui/AdjustmentSlider';
import type { RegistryControlProps } from './Slider';

/**
 * TintStrip — green/teal ↔ magenta tint picker for white-balance ops.
 *
 * Paired with `KelvinStrip` (Temperature). Matches the Lightroom convention:
 * negative tint → green/teal (left), neutral at zero (mid), positive tint →
 * magenta (right). Tint is the Lab `b*`-orthogonal axis; "teal" here is the
 * desaturated green that reads as the visual opposite of magenta.
 */

/** Teal → neutral → magenta gradient for the slider track. */
export function tintGradient(): string {
  const stops = [
    'hsl(170 50% 55%)',   // teal
    'hsl(170 25% 75%)',
    'hsl(0 0% 92%)',      // neutral midpoint
    'hsl(310 25% 75%)',
    'hsl(310 65% 60%)',   // magenta
  ];
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export function TintStrip({ schema, value, onChange, label, disabled, pinSlot }: RegistryControlProps) {
  if (schema.type !== 'scalar' || !schema.range) {
    throw new Error(`TintStrip needs a scalar param with range, got ${schema.type}`);
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
        trackGradient={tintGradient()}
        onChange={(v) => onChange(v)}
        formatValue={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}`}
        pinSlot={pinSlot}
      />
    </div>
  );
}
