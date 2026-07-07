import { Sparkles } from 'lucide-react';

interface GenfillViewProps {
  hasRegion: boolean;
  draft: string;
}

/** Static instruction panel for the palette's Generative fill mode. The
 *  actual submit lives in CommandPalette's keydown handler; this view only
 *  reflects whether a resolvable region chip is attached. */
export function CommandPaletteGenfillView({ hasRegion, draft }: GenfillViewProps) {
  return (
    <div className="flex-1 min-h-0 px-3 py-3 text-[12px] text-text-secondary">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-ai)] mb-2 inline-flex items-center gap-1">
        <Sparkles size={9} />
        <span>Generative fill</span>
      </div>
      {hasRegion ? (
        <p>
          Press <kbd className="px-1 border border-separator rounded-[3px]">↵</kbd> to
          generate
          {draft.trim() ? '' : ' — describe what should appear in the region'}. The result
          lands on a new layer after you accept it.
        </p>
      ) : (
        <p>
          Attach a target to fill — type <span className="text-text-primary">@</span> to
          reference a region, layer, or image. Generative fill needs a target.
        </p>
      )}
    </div>
  );
}
