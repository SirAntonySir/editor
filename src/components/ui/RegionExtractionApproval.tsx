import { Image as ImageIcon, Layers, X } from 'lucide-react';
import { useRegionExtractionApproval, type ExtractChoice } from '@/store/region-extraction-approval';
import { useAiAccess } from '@/lib/ai-access';

/** Per-region extraction choice chips (the pre-extraction gate). When a prompt
 *  carries attached `@region` chips, the agent turn pauses here and asks, per
 *  region, whether to extract it to a new image node, a new layer, or skip it.
 *  Lives in the FloatingDock alongside the agent's in-loop approval chips.
 *  Hidden in the study control condition (AI_access=false). */
export function RegionExtractionApproval() {
  const aiAccess = useAiAccess();
  const pending = useRegionExtractionApproval((s) => s.pending);
  if (!aiAccess || pending.length === 0) return null;

  const choose = (id: string, choice: ExtractChoice) =>
    useRegionExtractionApproval.getState().resolve(id, choice);

  return (
    <div className="flex flex-col items-center gap-1" role="region" aria-label="Region extraction choices">
      {pending.map((req) => (
        <div
          key={req.id}
          className="overlay pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-primary"
        >
          <span className="text-[var(--color-ai)] truncate max-w-[140px]">Extract “{req.label}”</span>
          <button
            type="button"
            aria-label="Extract to new image node"
            title="New image node"
            onClick={() => choose(req.id, 'node')}
            className="flex items-center gap-1 h-5 px-1.5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
          >
            <ImageIcon size={12} />
            <span>Node</span>
          </button>
          <button
            type="button"
            aria-label="Extract to new layer"
            title="New layer"
            onClick={() => choose(req.id, 'layer')}
            className="flex items-center gap-1 h-5 px-1.5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary"
          >
            <Layers size={12} />
            <span>Layer</span>
          </button>
          <button
            type="button"
            aria-label="Deny"
            title="Skip this region"
            onClick={() => choose(req.id, 'deny')}
            className="flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:bg-surface-secondary"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
