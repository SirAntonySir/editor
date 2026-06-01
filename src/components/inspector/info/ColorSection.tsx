import { Palette } from 'lucide-react';
import type { EnrichedImageContext } from '@/types/enriched-context';
import { Swatch } from '@/components/ui/Swatch';
import { SectionHeader } from './SectionHeader';

interface Props {
  ctx: EnrichedImageContext;
}

// Lab a*/b* are theoretically unbounded but typical natural images stay
// within ±50. Beyond that we clamp.
const AB_RANGE = 50;
const CAST_BOX_SIZE = 56;

export function ColorSection({ ctx }: Props) {
  const [r, g, b] = ctx.estimated_white_point;
  return (
    <section className="px-3 py-2.5 border-b border-separator">
      <SectionHeader icon={Palette} label="Color" />
      {ctx.color_palette.length > 0 && (
        <div className="flex h-5 mb-2.5 rounded-[3px] overflow-hidden border border-separator">
          {ctx.color_palette.map((s, i) => (
            <div
              key={i}
              style={{
                flexGrow: Math.max(s.weight, 0.02),
                minWidth: 8,
                backgroundColor: `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`,
              }}
              title={`#${hex(s.rgb[0])}${hex(s.rgb[1])}${hex(s.rgb[2])} · ${(s.weight * 100).toFixed(0)}%`}
            />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mb-2">
        <dt className="text-[10px] text-text-secondary">White point</dt>
        <dd className="text-[10px] text-text-primary text-right">
          <span className="inline-flex items-center gap-1">
            <Swatch rgb={ctx.estimated_white_point} size={10} />
            <span className="tabular-nums">rgb({Math.round(r)}, {Math.round(g)}, {Math.round(b)})</span>
          </span>
        </dd>
        <dt className="text-[10px] text-text-secondary">WB confidence</dt>
        <dd className="text-[10px] text-text-primary text-right tabular-nums">
          {(ctx.wb_neutral_confidence * 100).toFixed(0)}%
        </dd>
      </dl>
      {ctx.cast_strength > 0 && <CastDot direction={ctx.cast_direction} strength={ctx.cast_strength} />}
    </section>
  );
}

function CastDot({ direction, strength }: { direction: [number, number]; strength: number }) {
  const ax = clamp(direction[0], -AB_RANGE, AB_RANGE);
  const ay = clamp(direction[1], -AB_RANGE, AB_RANGE);
  const x = ((ax + AB_RANGE) / (2 * AB_RANGE)) * CAST_BOX_SIZE;
  const y = ((ay + AB_RANGE) / (2 * AB_RANGE)) * CAST_BOX_SIZE;
  return (
    <div>
      <div className="text-[10px] text-text-secondary mb-1">Color cast (a*/b*)</div>
      <div className="flex items-center gap-2">
        <div
          className="relative bg-surface-secondary rounded-[3px] border border-separator"
          style={{ width: CAST_BOX_SIZE, height: CAST_BOX_SIZE }}
        >
          <div className="absolute top-1/2 left-0 right-0 h-px bg-separator" />
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-separator" />
          <div
            className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-accent shadow-sm"
            style={{ left: x, top: y, opacity: Math.min(1, 0.4 + strength * 0.6) }}
          />
        </div>
        <div className="flex flex-col gap-0.5 text-[10px] tabular-nums">
          <span className="text-text-secondary">a*: <span className="text-text-primary">{ax.toFixed(1)}</span></span>
          <span className="text-text-secondary">b*: <span className="text-text-primary">{ay.toFixed(1)}</span></span>
          <span className="text-text-secondary">strength: <span className="text-text-primary">{(strength * 100).toFixed(0)}%</span></span>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
