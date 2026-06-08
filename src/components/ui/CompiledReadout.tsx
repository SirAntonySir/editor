export interface CompiledReadoutEntry {
  label: string;
  value: number;
  unit?: string;
  /** Optional accent color for the bar; falls back to `--color-accent`. */
  color?: string;
}

interface CompiledReadoutProps {
  entries: CompiledReadoutEntry[];
  topN: number;
  /** Below this absolute value, entries are treated as "no adjustment". */
  epsilon?: number;
}

/**
 * Live read-out of the top-N compiled params from a perceptual dial.
 * Two-column grid; each cell is label + signed value + bar proportional to |value|.
 * Pure presentational — caller selects entries.
 */
export function CompiledReadout({ entries, topN, epsilon = 0.01 }: CompiledReadoutProps) {
  const visible = entries
    .filter((e) => Math.abs(e.value) > epsilon)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, topN);

  if (visible.length === 0) {
    return (
      <div className="text-[10px] text-text-secondary text-center py-2">
        no adjustments
      </div>
    );
  }

  const maxAbs = visible.reduce((m, e) => Math.max(m, Math.abs(e.value)), 0) || 1;

  return (
    <div className="grid grid-cols-2 gap-2">
      {visible.map((e) => {
        const formatted = formatValue(e.value, e.unit);
        const pct = Math.min(100, Math.max(2, (Math.abs(e.value) / maxAbs) * 100));
        return (
          <div key={e.label} className="bg-surface-secondary rounded-[var(--radius-button)] px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-secondary">{e.label}</div>
            <div className="text-[13px] font-medium text-text-primary num">{formatted}</div>
            <div className="mt-1 h-[2px] bg-separator/50 rounded">
              <div
                className="h-full rounded"
                style={{
                  width: `${pct}%`,
                  background: e.color ?? 'var(--color-accent)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 100) body = `${Math.round(v)}`;
  else if (abs >= 10) body = v.toFixed(0);
  else if (abs >= 1) body = v.toFixed(1);
  else body = v.toFixed(2);
  if (v > 0 && !unit) body = `+${body}`;
  return unit ? `${body}${unit}` : body;
}
