import { AlertTriangle } from 'lucide-react';
import type { EnrichedImageContext, Problem } from '@/types/enriched-context';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

/** Standalone Problems section so the Info-tab skeleton can have a matching
 *  placeholder slot. Splits out of the old combined RegionsSection. */
export function ProblemsSection({ ctx }: Props) {
  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={AlertTriangle} label="Problems" count={ctx.problems.length} />
      {ctx.problems.length === 0 ? (
        <div className="text-[10px] text-text-secondary">No issues detected.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {ctx.problems.map((p, i) => (
            <ProblemRow key={i} problem={p} />
          ))}
        </div>
      )}
    </section>
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
