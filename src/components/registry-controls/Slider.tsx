import type { ReactNode } from 'react';
import { AdjustmentSlider } from '@/components/inspector/AdjustmentSlider';
import type { OpParam } from '../../../shared/registry/schema';

export interface RegistryControlProps {
  paramKey: string;
  label: string;
  value: unknown;
  schema: OpParam;
  onChange: (next: unknown) => void;
  disabled?: boolean;
  /** Per-binding affordance rendered next to the label (e.g. the Pin
   *  popover). Forwarded by controls that surface a label row; others
   *  ignore it. */
  pinSlot?: ReactNode;
}

export function Slider({ schema, value, onChange, label, disabled, pinSlot }: RegistryControlProps) {
  if (schema.type !== 'scalar' || !schema.range) {
    throw new Error(`Slider needs a scalar param with range, got ${schema.type}`);
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
        onChange={(v) => onChange(v)}
        formatValue={schema.unit ? (v) => `${Math.round(v)}${schema.unit}` : undefined}
        pinSlot={pinSlot}
      />
    </div>
  );
}
