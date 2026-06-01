import type { ComponentType, ReactNode } from 'react';

interface SectionHeaderProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  count?: number;
  right?: ReactNode;
}

/** Shared section header for the Info tab. Hairline divider + tiny icon +
 *  uppercase label + optional count chip / right-side content. */
export function SectionHeader({ icon: Icon, label, count, right }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 mb-2 text-text-secondary">
      <Icon size={11} className="opacity-80" />
      <span className="text-[9px] uppercase tracking-[0.08em] font-medium">{label}</span>
      {count !== undefined && (
        <span className="text-[9px] tabular-nums px-1 py-px rounded-sm bg-surface-secondary text-text-secondary">
          {count}
        </span>
      )}
      <span className="flex-1 h-px bg-separator" aria-hidden />
      {right}
    </div>
  );
}
