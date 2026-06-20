import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { RegionPickerSchema, MaskSummary } from '@/types/widget';

interface RegionPickerControlProps {
  label: string;
  value: string;
  default: string;
  schema: RegionPickerSchema;
  onChange: (value: string) => void;
  maskSummaries: MaskSummary[];
}

export function RegionPickerControl({ label, value, onChange, maskSummaries }: RegionPickerControlProps) {
  const named = maskSummaries.filter((m) => m.label);
  const current = named.find((m) => m.id === value);
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-primary">{label}</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="text-xs px-2 py-1 rounded bg-surface-secondary">
          {current?.label ?? 'Select region'}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="bg-surface border border-border-strong rounded p-1">
            {named.map((m) => (
              <DropdownMenu.Item
                key={m.id}
                onSelect={() => onChange(m.id)}
                className="text-xs px-2 py-1 hover:bg-surface-secondary rounded cursor-pointer"
              >
                {m.label}
              </DropdownMenu.Item>
            ))}
            {named.length === 0 && (
              <div className="text-xs px-2 py-1 text-text-secondary">No named regions</div>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
