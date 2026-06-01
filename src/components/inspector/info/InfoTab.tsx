import { useImageContextFull } from '@/hooks/useImageContextFull';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { ScrollArea } from '@/components/ui/ScrollArea';
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

  // Overlay shows only before the first context delta lands. The backend
  // streams `context.updated` in pieces (mechanical / ai_context / soft), so
  // ctx becomes non-null at the first delta and the overlay drops out
  // immediately — leaving the per-section skeletons to communicate
  // remaining progress as each delta swaps its slot in.
  const showOverlay = !ctx;

  // Per-section real-or-skeleton, keyed by which phase produced each
  // section's fields. With partial streaming, mechanical-only ctx has
  // histograms + palette but not subjects/problems/etc. — those sections
  // stay on the skeleton until their delta arrives. Optional chaining
  // everywhere because ctx is a partial dict during streaming.
  const hasSemantic =
    !!ctx && ((ctx.subjects?.length ?? 0) > 0 || !!ctx.lighting || !!ctx.mood);
  const hasHistograms = !!ctx && (ctx.luma_histogram?.length ?? 0) > 0;
  const hasColor = !!ctx && (ctx.color_palette?.length ?? 0) > 0;
  const hasRegions = !!ctx && (ctx.candidate_regions?.length ?? 0) > 0;
  // Problems renders once the soft-fields delta lands (the field exists).
  // Empty array is a valid "no issues" result, so we don't gate on length.
  const hasProblems = !!ctx && ctx.problems !== undefined;

  // Overlay sits as a SIBLING of the ScrollArea (not inside it) so the hero
  // copy stays fixed in the viewport rather than scrolling with the
  // skeleton content underneath.
  return (
    <div className="flex-1 min-h-0 relative">
      <ScrollArea className="absolute inset-0">
        {hasSemantic ? <SemanticSection ctx={ctx!} /> : <SemanticSkeleton />}
        {hasHistograms ? <HistogramsSection ctx={ctx!} /> : <HistogramsSkeleton />}
        {hasColor ? <ColorSection ctx={ctx!} /> : <ColorSkeleton />}
        {hasRegions ? <RegionsSection ctx={ctx!} /> : <RegionsSkeleton />}
        {hasProblems ? <ProblemsSection ctx={ctx!} /> : <ProblemsSkeleton />}
      </ScrollArea>
      {showOverlay && <NoContextState analyzing={inAnalyze} />}
    </div>
  );
}
