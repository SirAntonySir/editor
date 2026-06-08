import { useState } from 'react';
import type { RegistryControlProps } from './Slider';

/**
 * PointList — textarea showing `[[x,y],...]` JSON, parsed on blur.
 *
 * Functional debug fallback for `curve_points` params. Ugly but useful for
 * inspecting / overriding curve data in development.
 *
 * TODO: Replace with a visual curve editor for non-debug use (see CurveEditor).
 */

export function PointList({ value, onChange, label, disabled }: RegistryControlProps) {
  const serialized = JSON.stringify(value ?? [], null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  function handleBlur() {
    try {
      const parsed = JSON.parse(text);
      setError(null);
      onChange(parsed);
    } catch {
      setError('Invalid JSON — changes not applied');
    }
  }

  return (
    <div className={`flex flex-col gap-1${disabled ? ' pointer-events-none opacity-40' : ''}`}>
      <span className="text-[10px] text-text-secondary truncate">{label}</span>
      <textarea
        aria-label={label}
        value={text}
        rows={6}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
        spellCheck={false}
        className="w-full font-mono text-[10px] bg-surface-secondary text-text-primary border border-separator rounded px-2 py-1 resize-y outline-none focus:border-accent"
      />
      {error && (
        <span className="text-[9px] text-red-500">{error}</span>
      )}
    </div>
  );
}
