import type {
  EnrichedImageContext,
  EnrichedCandidateRegion,
  Problem,
} from '@/types/enriched-context';
import { PercentBar } from '@/components/ui/PercentBar';

interface Props {
  ctx: EnrichedImageContext;
}

export function RegionsSection({ ctx }: Props) {
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5 flex items-center gap-1.5">
        Regions
        <span className="bg-surface-secondary px-1 rounded-sm text-[8px]">{ctx.candidate_regions.length}</span>
      </div>
      {ctx.candidate_regions.map((r) => (
        <RegionRow key={`${r.label}-${r.description}`} region={r} />
      ))}
      {ctx.problems.length > 0 && (
        <>
          <div className="text-[9px] uppercase tracking-wide text-text-secondary mt-3 mb-1.5 flex items-center gap-1.5">
            Problems
            <span className="bg-surface-secondary px-1 rounded-sm text-[8px]">{ctx.problems.length}</span>
          </div>
          {ctx.problems.map((p, i) => (
            <ProblemRow key={i} problem={p} />
          ))}
        </>
      )}
    </section>
  );
}

function RegionRow({ region }: { region: EnrichedCandidateRegion }) {
  const src = region.mask_png_base64 ? `data:image/png;base64,${region.mask_png_base64}` : null;
  return (
    <div className="flex gap-2 items-start py-1">
      {src ? (
        <img src={src} alt="" className="w-8 h-8 rounded-sm bg-surface-secondary object-cover" />
      ) : (
        <div className="w-8 h-8 rounded-sm bg-surface-secondary" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-text-primary truncate">{region.label}</div>
        <div className="text-[9px] text-text-secondary truncate">{region.description}</div>
      </div>
    </div>
  );
}

function ProblemRow({ problem }: { problem: Problem }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-[8px] uppercase tracking-wide px-1 py-0.5 bg-surface-secondary text-text-primary rounded-sm">
          {problem.kind.replace(/_/g, ' ')}
        </span>
        {problem.region_label && (
          <span className="text-[9px] text-text-secondary">@ {problem.region_label}</span>
        )}
      </div>
      <PercentBar pct={problem.severity * 100} color="#f59e0b" label="Severity" />
      {problem.suggested_fused_tools.length > 0 && (
        <div className="text-[9px] text-text-secondary mt-0.5">
          Suggested: {problem.suggested_fused_tools.join(', ')}
        </div>
      )}
    </div>
  );
}
