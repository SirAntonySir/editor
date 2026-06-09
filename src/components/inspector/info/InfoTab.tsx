import { useMemo } from 'react';
import { useImageContextFull } from '@/hooks/useImageContextFull';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { useLiveMechanicalContext } from '@/hooks/useLiveMechanicalContext';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { SemanticSection } from './SemanticSection';
import { HistogramsSection } from './HistogramsSection';
import { ColorSection } from './ColorSection';
import { MetadataSection } from './MetadataSection';
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
import type { EnrichedImageContext } from '@/types/enriched-context';
import type { MechanicalSnapshot } from '@/lib/mechanical-context';

/**
 * Info tab. Five sections always render — as the real component if the
 * matching context fields are present, otherwise as a structural skeleton.
 * When no context exists at all, a centred overlay sits on top of the
 * skeleton with hero copy + an AI CTA; once analyze kicks off, the overlay
 * morphs into the violet stepper (still on top of the skeleton). The
 * overlay fades away once `image_context` arrives.
 */
/** Overlay the live mechanical snapshot onto the backend ctx so the
 *  Histograms + Color sections render off the current edited image. When
 *  the backend ctx is absent but a live snapshot is present (user editing
 *  before analyze completed), synthesise a partial ctx — AI fields stay
 *  unset, the mechanical sections gracefully render the parts they care
 *  about. When neither is present, returns null. */
function withLiveMechanical(
  ctx: EnrichedImageContext | null,
  live: MechanicalSnapshot | null,
): EnrichedImageContext | null {
  if (!ctx && !live) return null;
  if (!ctx) return { ...live! } as unknown as EnrichedImageContext;
  if (!live) return ctx;
  return { ...ctx, ...live };
}

export function InfoTab() {
  const ctx = useImageContextFull();
  const live = useLiveMechanicalContext();
  const phases = useBackendState((s) => s.phases);
  const mcpComplete = useBackendState((s) => s.mcpAnalyzeComplete);
  const aiStatus = useAiSession((s) => s.status);

  const preAnalyze = aiStatus === 'uploading' || aiStatus === 'analysing';
  const inAnalyze = preAnalyze || (phases !== null && !mcpComplete);

  // Mechanical sections render off whichever signal is fresher: the live
  // snapshot (recomputed on every composite) when present, otherwise the
  // backend's analyze-time pass. AI-derived sections (Semantic, Regions,
  // Problems) always use the backend ctx — they describe the original
  // image and don't update with local edits.
  const mechCtx = useMemo(() => withLiveMechanical(ctx, live), [ctx, live]);

  // Overlay shows only before the first context delta lands. The backend
  // streams `context.updated` in pieces (mechanical / ai_context / soft), so
  // ctx becomes non-null at the first delta and the overlay drops out
  // immediately — leaving the per-section skeletons to communicate
  // remaining progress as each delta swaps its slot in.
  //
  // Live mechanical data alone is also sufficient to lift the overlay —
  // once the user starts editing, the canvas is publishing snapshots even
  // if analyze never ran.
  const showOverlay = !ctx && !live;

  // Per-section real-or-skeleton, keyed by which phase produced each
  // section's fields. With partial streaming, mechanical-only ctx has
  // histograms + palette but not subjects/problems/etc. — those sections
  // stay on the skeleton until their delta arrives. Optional chaining
  // everywhere because ctx is a partial dict during streaming.
  const hasSemantic =
    !!ctx && ((ctx.subjects?.length ?? 0) > 0 || !!ctx.lighting || !!ctx.mood);
  const hasHistograms = (!!mechCtx && (mechCtx.luma_histogram?.length ?? 0) > 0) || !!live;
  const hasColor = (!!mechCtx && (mechCtx.color_palette?.length ?? 0) > 0) || !!live;
  const hasRegions = !!ctx && (ctx.candidate_regions?.length ?? 0) > 0;
  // Problems renders once the soft-fields delta lands (the field exists).
  // Empty array is a valid "no issues" result, so we don't gate on length.
  const hasProblems = !!ctx && ctx.problems !== undefined;

  // Section order: mechanical lives at the top because it's the part of
  // the Info tab that responds to edits in real time. AI-derived
  // semantic / regions / problems follow below — they're snapshot-y and
  // describe the upload-time image.
  return (
    <div className="flex-1 min-h-0 relative flex flex-col">
      <ScrollArea className="flex-1 min-h-0">
        {hasHistograms ? <HistogramsSection ctx={mechCtx!} /> : <HistogramsSkeleton />}
        {hasColor ? <ColorSection ctx={mechCtx!} /> : <ColorSkeleton />}
        {/* MetadataSection self-gates on `documentMeta.metadata` — it renders
            null when no EXIF was parsed, so we don't need a wrapping check. */}
        <MetadataSection />
        {hasSemantic ? <SemanticSection ctx={ctx!} /> : <SemanticSkeleton />}
        {hasRegions ? <RegionsSection ctx={ctx!} /> : <RegionsSkeleton />}
        {hasProblems ? <ProblemsSection ctx={ctx!} /> : <ProblemsSkeleton />}
      </ScrollArea>
      {showOverlay && <NoContextState analyzing={inAnalyze} />}
    </div>
  );
}
