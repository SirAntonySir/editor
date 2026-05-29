interface Props {
  pct: number;
  color: string;
  label?: string;
}

export function PercentBar({ pct, color, label }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2 text-[10px] text-text-secondary">
      {label && <span className="flex-1 truncate">{label}</span>}
      <div className="flex-1 h-0.5 bg-surface-secondary rounded">
        <div
          data-fill
          style={{ width: `${clamped}%`, height: '100%', backgroundColor: color, borderRadius: 2 }}
        />
      </div>
      {label && <span className="w-10 text-right tabular-nums">{clamped.toFixed(1)}%</span>}
    </div>
  );
}
