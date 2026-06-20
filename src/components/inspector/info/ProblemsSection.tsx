import { AlertTriangle } from 'lucide-react';
import type { ImageContext, Problem } from '@/types/image-context';
import { PercentBar } from '@/components/ui/PercentBar';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: ImageContext;
}

function dispatchChipToPalette(item: { label: string; value: string; sourceId?: string }) {
  window.dispatchEvent(new CustomEvent('spawn-palette:open', {
    detail: { attachContext: [item] },
  }));
}

/** Standalone Problems section so the Info-tab skeleton can have a matching
 *  placeholder slot. Splits out of the old combined RegionsSection. */
export function ProblemsSection({ ctx }: Props) {
  const problems = ctx.problems ?? [];
  return (
    <section className="px-3 py-2.5">
      <SectionHeader icon={AlertTriangle} label="Problems" count={problems.length} />
      {problems.length === 0 ? (
        <div className="text-[10px] text-text-secondary">No issues detected.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {problems.map((p, i) => (
            <ProblemRow key={i} problem={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProblemRow({ problem }: { problem: Problem }) {
  const kindLabel = problem.kind.replace(/_/g, ' ');
  const severityPct = (problem.severity * 100).toFixed(1);
  const contextValue = problem.regionLabel
    ? `${kindLabel} (${severityPct}%) @ ${problem.regionLabel}`
    : `${kindLabel} (${severityPct}%)`;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <button
          type="button"
          onClick={() =>
            dispatchChipToPalette({
              label: 'Problem',
              value: contextValue,
              sourceId: `problem:${problem.kind}`,
            })
          }
          title={`Attach as context: ${contextValue}`}
          className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 bg-surface-secondary text-text-primary rounded-sm cursor-pointer hover:bg-accent/15 transition-colors"
        >
          {kindLabel}
        </button>
        {problem.regionLabel && (
          <span className="text-[10px] text-text-secondary truncate">@ {problem.regionLabel}</span>
        )}
      </div>
      <PercentBar pct={problem.severity * 100} color="#f59e0b" label="Severity" />
      {(problem.suggestedFusedTools?.length ?? 0) > 0 && (
        <div className="text-[10px] text-text-secondary mt-1 flex flex-wrap gap-1">
          {problem.suggestedFusedTools.map((id) => (
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
