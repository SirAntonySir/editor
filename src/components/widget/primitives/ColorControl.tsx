import type { ColorSchema } from '@/types/widget';

interface ColorControlProps {
  label: string;
  value: string;
  default: string;
  schema: ColorSchema;
  onChange: (value: string) => void;
}

export function ColorControl({ label, value, onChange }: ColorControlProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-5 rounded cursor-pointer"
      />
    </div>
  );
}
