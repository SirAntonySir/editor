import type { SliderSchema } from '@/types/widget';

interface SliderControlProps {
  label: string;
  value: number;
  default: number;
  schema: SliderSchema;
  onChange: (value: number) => void;
}

export function SliderControl({ label, value, schema, onChange }: SliderControlProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-primary">{label}</span>
        <span className="text-xs text-text-secondary">{value}{schema.unit ?? ''}</span>
      </div>
      <input
        type="range"
        role="slider"
        min={schema.min}
        max={schema.max}
        step={schema.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
