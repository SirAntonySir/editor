import * as ToggleGroup from '@radix-ui/react-toggle-group';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label'?: string;
}

/**
 * Minimal pill segmented control: a recessed track with a single raised active
 * segment. Single-select; clicking the active segment is ignored (Radix would
 * otherwise deselect to an empty value). Tokens only — no shadow (docked chrome).
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      className="flex gap-0.5 p-0.5 rounded-button bg-surface-secondary"
    >
      {options.map((opt) => (
        <ToggleGroup.Item
          key={opt.value}
          value={opt.value}
          className="flex-1 text-[10px] leading-none py-1 rounded-sm transition-colors duration-150
            text-text-secondary hover:text-text-primary
            data-[state=on]:bg-surface data-[state=on]:text-text-primary data-[state=on]:font-medium"
        >
          {opt.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
