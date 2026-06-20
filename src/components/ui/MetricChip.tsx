import type { ComponentType } from 'react';

interface Props {
  label: string;
  value: string;
  /** Optional leading icon. Used by the Aperture chip to give the capture
   *  row a focal point; most chips render without one. */
  icon?: ComponentType<{ size?: number; className?: string }>;
}

/**
 * Shared two-line metric chip used by every "chips like this" surface in
 * the Info tab: EXIF capture, document, file, tone stats, color cast, etc.
 *
 * Stretches to fill the grid cell it sits in (the parent grid uses
 * `repeat(auto-fit, minmax(72px, 1fr))` to share the row's width). Long
 * values truncate rather than wrap — keeps the chip height stable so
 * neighbouring chips in the row don't jump.
 */
export function MetricChip({ label, value, icon: Icon }: Props) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-[3px] w-full
        bg-surface-secondary border border-separator"
      title={`${label}: ${value}`}
    >
      {Icon && <Icon size={10} className="text-text-secondary opacity-80 flex-none" />}
      <div className="flex flex-col leading-none min-w-0">
        <span className="text-[8px] uppercase tracking-wide text-text-secondary truncate">{label}</span>
        <span className="text-[10px] text-text-primary tabular-nums mt-0.5 truncate">{value}</span>
      </div>
    </div>
  );
}

/** Standard auto-fit grid wrapper. Use this anywhere multiple MetricChips
 *  share a row so they all use the same minmax floor + 1fr distribution. */
export function MetricChipGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))' }}
    >
      {children}
    </div>
  );
}
