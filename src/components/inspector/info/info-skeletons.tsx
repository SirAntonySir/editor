import { Tag, BarChart3, Palette, MapPin, AlertTriangle } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

/**
 * Static skeleton placeholders for each Info-tab section. These render behind
 * (and at the same layout rhythm as) the real section components — when the
 * backend returns data for a section, the real component overlays the
 * matching skeleton in-place and the skeleton stays as a structural backdrop.
 *
 * Intentionally static (no shimmer animation) — the section progress signal
 * comes from the analyze stepper overlay, not from chrome-busy decoration.
 */

function SkeletonShell({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-2 text-text-secondary">
        <Icon size={11} className="opacity-60" />
        <span className="text-[9px] uppercase tracking-[0.08em] font-medium">{label}</span>
        <span className="flex-1 h-px bg-separator" aria-hidden />
      </div>
      {children}
    </section>
  );
}

function Chip({ width }: { width: number }) {
  return (
    <span
      style={{ width }}
      className="h-[18px] rounded-[3px] bg-surface-secondary"
    />
  );
}

function Row() {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mb-1">
      <span className="w-12 h-2.5 rounded-sm bg-surface-secondary" />
      <span className="justify-self-end w-16 h-2.5 rounded-sm bg-surface-secondary" />
    </div>
  );
}

function Bar() {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2.5 rounded-sm bg-surface-secondary" />
      <div className="flex-1 h-2 rounded-full bg-surface-secondary" />
      <div className="w-8 h-2.5 rounded-sm bg-surface-secondary" />
    </div>
  );
}

function Line({ width, muted }: { width: string; muted?: boolean }) {
  return (
    <div
      style={{ width }}
      className={`h-2.5 rounded-sm bg-surface-secondary ${muted ? 'opacity-70' : ''} mb-1 last:mb-0`}
    />
  );
}

export function SemanticSkeleton() {
  return (
    <SkeletonShell icon={Tag} label="Semantic">
      <div className="flex flex-wrap gap-1 mb-1.5">
        <Chip width={64} />
        <Chip width={48} />
        <Chip width={56} />
        <Chip width={40} />
      </div>
      <Row />
      <Row />
      <Row />
    </SkeletonShell>
  );
}

export function HistogramsSkeleton() {
  return (
    <SkeletonShell icon={BarChart3} label="Histograms">
      <div className="rounded-[3px] bg-surface-secondary p-1.5 border border-separator h-[68px]" />
      <div className="flex flex-col gap-1 mt-2">
        <Bar />
        <Bar />
      </div>
    </SkeletonShell>
  );
}

export function ColorSkeleton() {
  return (
    <SkeletonShell icon={Palette} label="Color">
      <div className="flex h-5 mb-2 rounded-[3px] overflow-hidden border border-separator">
        {[15, 22, 18, 12, 14, 10, 9].map((w, i) => (
          <div key={i} style={{ flexGrow: w }} className="bg-surface-secondary" />
        ))}
      </div>
      <Row />
      <Row />
    </SkeletonShell>
  );
}

export function RegionsSkeleton() {
  return (
    <SkeletonShell icon={MapPin} label="Elements">
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-2 items-center py-0.5">
            <div className="w-9 h-9 rounded-[3px] bg-surface-secondary" />
            <div className="flex-1 min-w-0">
              <Line width="40%" />
              <Line width="70%" muted />
            </div>
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}

export function ProblemsSkeleton() {
  return (
    <SkeletonShell icon={AlertTriangle} label="Problems">
      <div className="flex flex-col gap-2">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-14 h-3 rounded-sm bg-surface-secondary" />
              <span className="w-20 h-2.5 rounded-sm bg-surface-secondary opacity-70" />
            </div>
            <Bar />
          </div>
        ))}
      </div>
    </SkeletonShell>
  );
}
