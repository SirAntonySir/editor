import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';

export interface EditableParamCardProps {
  label: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  /** Optional accent color for the bar; falls back to `--color-accent`. */
  color?: string;
  /** Reflects `widget.locked_params` membership. Locked cards show the lock icon
   *  always; unlocked cards reveal it on hover. */
  locked: boolean;
  /** Called on commit (Enter, blur with valid number). Caller debounces. */
  onChange: (v: number) => void;
  /** Called when the user clicks the lock icon on a locked card. Restores the
   *  dial-derived value on the backend; the next snapshot tick flips the icon back. */
  onUnlock: () => void;
}

/**
 * Compact, click-to-edit param card used by the Time-of-Day dial readout.
 * Click the value to enter a number; Enter or blur commits. Lock icon
 * appears on hover (unlocked) or persistently (locked); clicking it on a
 * locked card asks the caller to clear the lock.
 *
 * Drag-to-scrub is intentionally out of scope for v1 — click-to-keyboard
 * is the immediate requirement. A future revision can add pointer-drag.
 */
export function EditableParamCard({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  color,
  locked,
  onChange,
  onUnlock,
}: EditableParamCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    const parsed = Number(draft);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      if (clamped !== value) onChange(clamped);
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  const span = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const pct = Math.min(100, Math.max(2, (Math.abs(value) / span) * 100));

  return (
    <div
      className="group relative bg-surface-secondary rounded-[var(--radius-button)] px-2 py-1.5"
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-[9px] uppercase tracking-wide text-text-secondary truncate">
          {label}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (locked) onUnlock();
          }}
          aria-label={locked ? `Unlock ${label}` : `${label} not locked`}
          tabIndex={locked ? 0 : -1}
          className={[
            'shrink-0 transition-opacity',
            locked
              ? 'opacity-100 text-[var(--color-accent)] cursor-pointer'
              : 'opacity-0 group-hover:opacity-40 text-text-secondary cursor-default pointer-events-none',
          ].join(' ')}
        >
          <Lock size={9} />
        </button>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          className="w-full bg-transparent outline-none text-[13px] font-medium text-text-primary num appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(String(value)); setEditing(true); }}
          aria-label={`Edit ${label}`}
          className="w-full text-left text-[13px] font-medium text-text-primary num cursor-text hover:text-[var(--color-accent)] transition-colors"
        >
          {formatValue(value, unit)}
        </button>
      )}
      <div className="mt-1 h-[2px] bg-separator/50 rounded">
        <div
          className="h-full rounded"
          style={{
            width: `${pct}%`,
            background: color ?? 'var(--color-accent)',
          }}
        />
      </div>
    </div>
  );
}

function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 100) body = `${Math.round(v)}`;
  else if (abs >= 10) body = v.toFixed(0);
  else if (abs >= 1) body = v.toFixed(1);
  else if (abs === 0) body = '0';
  else body = v.toFixed(2);
  if (v > 0 && !unit) body = `+${body}`;
  return unit ? `${body}${unit}` : body;
}
