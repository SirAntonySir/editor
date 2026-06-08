import type { RegistryControlProps } from './Slider';

/**
 * EnumSelect — native <select> over schema.values.
 * Handles `enum` params.
 */
export function EnumSelect({ schema, value, onChange, label, disabled }: RegistryControlProps) {
  if (schema.type !== 'enum' || !schema.values) {
    throw new Error(`EnumSelect needs an enum param with values, got ${schema.type}`);
  }
  const strValue = typeof value === 'string' ? value : String(schema.default ?? '');

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-text-secondary truncate">{label}</span>
      <select
        aria-label={label}
        value={strValue}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="text-[10px] bg-surface-secondary text-text-primary border border-separator rounded px-1.5 py-0.5 outline-none focus:border-accent cursor-pointer disabled:opacity-40 disabled:cursor-default"
      >
        {schema.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </div>
  );
}
