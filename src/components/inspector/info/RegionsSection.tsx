import { MapPin } from 'lucide-react';
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
  // Region-stats lookup for area weighting on the palette chip. The old
  // skin/sky hint icons were dropped — the masked thumbnail already SHOWS
  // what the element is; a second glyph next to the name read as noise.
  const statsByLabel = new Map((ctx.regionStats ?? []).map((s) => [s.label, s]));
  return (
    <section className="px-3 py-2.5">
      <SectionHeader icon={MapPin} label="Elements" count={ctx.candidateRegions.length} />
      <div className="flex flex-col gap-1.5">
        {ctx.candidateRegions.map((r) => (
          <RegionRow
            key={`${r.label}-${r.description}`}
            region={r}
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
  areaWeight,
}: {
  region: CandidateRegion;
  areaWeight?: number;
}) {
  // Build a context value like "sky (0.42)" when area info is available.
  const contextValue =
    areaWeight !== undefined
      ? `${region.label} (${areaWeight.toFixed(2)})`
      : region.label;

  return (
    <div className="flex gap-2 items-center py-0.5">
      <RegionThumbnail
        bbox={region.bbox ?? null}
        maskRef={region.maskRef ?? null}
        fallback={initialFor(region.label)}
      />
      <div className="flex-1 min-w-0">
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
          className="block max-w-full text-[11px] text-text-primary truncate cursor-pointer hover:text-accent transition-colors text-left"
        >
          {region.label}
        </button>
        {region.description && (
          <div className="text-[10px] text-text-secondary truncate leading-snug">
            {region.description}
          </div>
        )}
      </div>
    </div>
  );
}
