import { useImageContextFull } from '@/hooks/useImageContextFull';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { SemanticSection } from './SemanticSection';
import { HistogramsSection } from './HistogramsSection';
import { ColorSection } from './ColorSection';
import { RegionsSection } from './RegionsSection';
import { ProblemsSection } from './ProblemsSection';
import { NoContextState } from './NoContextState';
import {
  SemanticSkeleton,
  HistogramsSkeleton,
  ColorSkeleton,
  RegionsSkeleton,
  ProblemsSkeleton,
} from './info-skeletons';

/**
 * Info tab. Five sections always render — as the real component if the
 * matching context fields are present, otherwise as a structural skeleton.
 * When no context exists at all, a centred overlay sits on top of the
 * skeleton with hero copy + an AI CTA; once analyze kicks off, the overlay
 * morphs into the violet stepper (still on top of the skeleton). The
 * overlay fades away once `image_context` arrives.
 */
export function InfoTab() {
  const ctx = useImageContextFull();
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const aiStatus = useAiSession((s) => s.status);

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  const inAnalyze = preAnalyze || (phases !== null && !mcpComplete);
  const livePhases = mcpComplete ? null : phases;
  const prePhaseText =
    livePhases
      ? null
      : aiStatus === 'uploading'
      ? 'Uploading image…'
      : aiStatus === 'analysing'
      ? 'Connecting to backend…'
      : null;

  // Overlay is visible whenever there's no context yet. The moment ctx lands,
  // the overlay drops out and the real sections take over the skeleton slots.
  const showOverlay = !ctx;

  // Per-section real-or-skeleton. The image_context arrives as a blob via
  // REST after analyze, so in practice all five flip together — but the
  // per-field guard means a malformed snapshot degrades gracefully (the
  // section that lacks its field stays as skeleton instead of crashing).
  const hasSemantic = !!ctx && (ctx.subjects.length > 0 || !!ctx.lighting || !!ctx.mood);
  const hasHistograms = !!ctx && ctx.luma_histogram.length > 0;
  const hasColor = !!ctx && ctx.color_palette.length > 0;
  const hasRegions = !!ctx && ctx.candidate_regions.length > 0;
  // Problems is special: empty array is a valid "no issues" result, so the
  // section's "real" view shows once ctx is present at all.
  const hasProblems = !!ctx;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto relative">
      {hasSemantic ? <SemanticSection ctx={ctx!} /> : <SemanticSkeleton />}
      {hasHistograms ? <HistogramsSection ctx={ctx!} /> : <HistogramsSkeleton />}
      {hasColor ? <ColorSection ctx={ctx!} /> : <ColorSkeleton />}
      {hasRegions ? <RegionsSection ctx={ctx!} /> : <RegionsSkeleton />}
      {hasProblems ? <ProblemsSection ctx={ctx!} /> : <ProblemsSkeleton />}
      {showOverlay && (
        <NoContextState
          analyzing={inAnalyze}
          phases={livePhases}
          prePhaseText={prePhaseText}
        />
      )}
    </div>
  );
}
