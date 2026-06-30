import { MapPin, User, Cloud } from 'lucide-react';
import type {
  ImageContext,
  CandidateRegion,
} from '@/types/image-context';
import { SectionHeader } from './SectionHeader';
import { RegionThumbnail } from './RegionThumbnail';

interface Props {
  ctx: ImageContext;
}

function dispatchChipToPalette(item: { label: string; value: string; sourceId?: string }) {
  window.dispatchEvent(new CustomEvent('spawn-palette:open', {
    detail: { attachContext: [item] },
  }));
}

export function RegionsSection({ ctx }: Props) {
  // Region-stats lookup so we can surface skin/sky hints next to each region.
  // regionStats arrives on the SOFT delta — when candidateRegions is
  // already in (ai_context delta) but regionStats isn't yet, the map is
  // empty and the hint icons simply don't render. Defaults to [] to handle
  // the partial-streaming case without crashing.
  const statsByLabel = new Map((ctx.regionStats ?? []).map((s) => [s.label, s]));
  return (
    <section className="px-3 py-2.5">
      <SectionHeader icon={MapPin} label="Elements" count={ctx.candidateRegions.length} />
      <div className="flex flex-col gap-1.5">
        {ctx.candidateRegions.map((r) => (
          <RegionRow
            key={`${r.label}-${r.description}`}
            region={r}
            isSkin={statsByLabel.get(r.label)?.isSkinLikely ?? false}
            isSky={statsByLabel.get(r.label)?.isSkyLikely ?? false}
            areaWeight={statsByLabel.get(r.label)?.pixelCount}
          />
        ))}
      </div>
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
  areaWeight,
}: {
  region: CandidateRegion;
  isSkin: boolean;
  isSky: boolean;
  areaWeight?: number;
}) {
  // Build a context value like "sky (0.42)" when area info is available.
  const contextValue =
    areaWeight !== undefined
      ? `${region.label} (${areaWeight.toFixed(2)})`
      : region.label;

  return (
    <div className="flex gap-2 items-center py-0.5">
      <RegionThumbnail bbox={region.bbox ?? null} fallback={initialFor(region.label)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              dispatchChipToPalette({
                label: 'Region',
                value: contextValue,
                sourceId: `region:${region.label}`,
              })
            }
            title={`Attach as context: ${region.label}`}
            className="text-[11px] text-text-primary truncate cursor-pointer hover:text-accent transition-colors text-left"
          >
            {region.label}
          </button>
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
