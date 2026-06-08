import type { RegistryControlProps } from './Slider';

/**
 * BoolToggle — checkbox for `bool` params.
 */
export function BoolToggle({ schema, value, onChange, label, disabled }: RegistryControlProps) {
  void schema; // bool params have no extra constraints
  const checked = typeof value === 'boolean' ? value : Boolean(schema.default);

  return (
    <label className={`flex items-center justify-between gap-2 cursor-pointer${disabled ? ' pointer-events-none opacity-40' : ''}`}>
      <span className="text-[10px] text-text-secondary truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-accent cursor-pointer"
        aria-label={label}
      />
    </label>
  );
}
