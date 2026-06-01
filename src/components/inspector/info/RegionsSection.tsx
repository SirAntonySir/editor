import { MapPin, AlertTriangle, User, Cloud } from 'lucide-react';
import type {
  EnrichedImageContext,
  EnrichedCandidateRegion,
  Problem,
} from '@/types/enriched-context';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';
import { RegionThumbnail } from './RegionThumbnail';

interface Props {
  ctx: EnrichedImageContext;
}

export function RegionsSection({ ctx }: Props) {
  // Region-stats lookup so we can surface skin/sky hints next to each region.
  const statsByLabel = new Map(ctx.region_stats.map((s) => [s.label, s]));
  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={MapPin} label="Regions" count={ctx.candidate_regions.length} />
      <div className="flex flex-col gap-1.5">
        {ctx.candidate_regions.map((r) => (
          <RegionRow
            key={`${r.label}-${r.description}`}
            region={r}
            isSkin={statsByLabel.get(r.label)?.is_skin_likely ?? false}
            isSky={statsByLabel.get(r.label)?.is_sky_likely ?? false}
          />
        ))}
      </div>
      {ctx.problems.length > 0 && (
        <div className="mt-3">
          <SectionHeader icon={AlertTriangle} label="Problems" count={ctx.problems.length} />
          <div className="flex flex-col gap-2">
            {ctx.problems.map((p, i) => (
              <ProblemRow key={i} problem={p} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function initialFor(label: string): string {
  const t = label.trim();
  return t ? t.charAt(0).toUpperCase() : '·';
}

function RegionRow({
  region,
  isSkin,
  isSky,
}: {
  region: EnrichedCandidateRegion;
  isSkin: boolean;
  isSky: boolean;
}) {
  return (
    <div className="flex gap-2 items-center py-0.5">
      <RegionThumbnail bbox={region.bbox ?? null} fallback={initialFor(region.label)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-text-primary truncate">{region.label}</span>
          {isSkin && (
            <span title="Skin-likely" className="inline-flex items-center text-amber-500/80">
              <User size={9} />
            </span>
          )}
          {isSky && (
            <span title="Sky-likely" className="inline-flex items-center text-sky-500/80">
              <Cloud size={9} />
            </span>
          )}
        </div>
        {region.description && (
          <div className="text-[10px] text-text-secondary truncate leading-snug">
            {region.description}
          </div>
        )}
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: Problem }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 bg-surface-secondary text-text-primary rounded-sm">
          {problem.kind.replace(/_/g, ' ')}
        </span>
        {problem.region_label && (
          <span className="text-[10px] text-text-secondary truncate">@ {problem.region_label}</span>
        )}
      </div>
      <PercentBar pct={problem.severity * 100} color="#f59e0b" label="Severity" />
      {problem.suggested_fused_tools.length > 0 && (
        <div className="text-[10px] text-text-secondary mt-1 flex flex-wrap gap-1">
          {problem.suggested_fused_tools.map((id) => (
            <span
              key={id}
              className="bg-surface-secondary border border-separator rounded-[3px] px-1.5 py-px tabular-nums"
            >
              {id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
