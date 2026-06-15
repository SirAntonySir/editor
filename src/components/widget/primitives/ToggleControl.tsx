import { Switch } from '@radix-ui/react-switch';
import type { ToggleSchema } from '@/types/widget';

interface ToggleControlProps {
  label: string;
  value: boolean;
  default: boolean;
  schema: ToggleSchema;
  onChange: (value: boolean) => void;
}

export function ToggleControl({ label, value, schema, onChange }: ToggleControlProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary">
          {value ? schema.onLabel : schema.offLabel}
        </span>
        <Switch
          checked={value}
          onCheckedChange={onChange}
          className="w-8 h-5 rounded-full bg-surface-secondary data-[state=checked]:bg-accent"
        />
      </div>
    </div>
  );
}
