import { useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import type { ImageContext, Problem } from '@/types/image-context';
import { PercentBar } from '@/components/ui/PercentBar';
import { useAiAccess } from '@/lib/ai-access';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { resolveTargetImageLayerId } from '@/hooks/useImageContext';
import { toast } from '@/components/ui/Toast';
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
  // Study gate: the Correct action mints an AI-resolved widget — baseline
  // participants see the diagnosis (badge + severity) without the AI fix.
  const aiAccess = useAiAccess();
  const offline = useBackendState((s) => s.sseStatus !== 'open');
  const showCorrect = aiAccess && !offline;
  return (
    <section className="px-3 py-2.5">
      <SectionHeader icon={AlertTriangle} label="Problems" count={problems.length} />
      {problems.length === 0 ? (
        <div className="text-[10px] text-text-secondary">No issues detected.</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {problems.map((p, i) => (
            <ProblemRow key={i} problem={p} showCorrect={showCorrect} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProblemRow({ problem, showCorrect }: { problem: Problem; showCorrect: boolean }) {
  const [busy, setBusy] = useState(false);
  const kindLabel = problem.kind.replace(/_/g, ' ');
  const severityPct = (problem.severity * 100).toFixed(1);
  const contextValue = problem.regionLabel
    ? `${kindLabel} (${severityPct}%) @ ${problem.regionLabel}`
    : `${kindLabel} (${severityPct}%)`;
  const hasCorrection =
    (problem.suggestedOps?.length ?? 0) > 0 ||
    (problem.suggestedFusedTools?.length ?? 0) > 0;

  async function handleCorrect() {
    if (busy) return;
    const sessionId = useBackendState.getState().sessionId;
    if (!sessionId) return;
    setBusy(true);
    try {
      const env = await backendTools.correct_problem(sessionId, {
        problemKind: problem.kind,
        regionLabel: problem.regionLabel ?? null,
        layerId: resolveTargetImageLayerId() ?? undefined,
      });
      if (!env.ok) {
        toast.info(`Correction failed: ${env.error?.message ?? 'unknown error'}`);
      }
    } catch (err) {
      console.error('[ProblemsSection] correct failed:', err);
      toast.info('Correction failed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
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
          <span className="text-[10px] text-text-secondary truncate min-w-0">
            @ {problem.regionLabel}
          </span>
        )}
        {/* The correction spawns as an AI-resolved widget on the canvas —
            one action per problem, no internal template ids on display. */}
        {showCorrect && hasCorrection && (
          <button
            type="button"
            onClick={() => void handleCorrect()}
            disabled={busy}
            title={`Correct "${kindLabel}" on the canvas`}
            className={`ml-auto inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[3px]
              border border-separator text-[var(--color-ai)] transition-colors ${
              busy ? 'opacity-60 cursor-default' : 'hover:bg-surface-secondary cursor-pointer'
            }`}
          >
            {busy
              ? <Loader2 size={9} className="animate-spin" aria-hidden />
              : <Sparkles size={9} aria-hidden />}
            Correct
          </button>
        )}
      </div>
      <PercentBar pct={problem.severity * 100} color="#f59e0b" label="Severity" />
    </div>
  );
}
