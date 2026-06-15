import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ChoiceSchema } from '@/types/widget';

interface ChoiceControlProps {
  label: string;
  value: string;
  default: string;
  schema: ChoiceSchema;
  onChange: (value: string) => void;
}

export function ChoiceControl({ label, value, schema, onChange }: ChoiceControlProps) {
  const current = schema.options.find((o) => o.value === value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="text-xs px-2 py-1 rounded bg-surface-secondary">
          {current?.label ?? value}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-surface border border-border-strong rounded p-1">
            {schema.options.map((opt) => (
              <DropdownMenu.Item
                key={opt.value}
                onSelect={() => onChange(opt.value)}
                className="text-xs px-2 py-1 hover:bg-surface-secondary rounded cursor-pointer"
              >
                {opt.label}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
