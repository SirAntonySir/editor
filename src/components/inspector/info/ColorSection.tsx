import type { EnrichedImageContext } from '@/types/enriched-context';
import { Swatch } from '@/components/ui/Swatch';

interface Props {
  ctx: EnrichedImageContext;
}

// Lab a*/b* are theoretically unbounded but typical natural images stay
// within ±50. Beyond that we clamp.
const AB_RANGE = 50;
const CAST_BOX_SIZE = 60;

export function ColorSection({ ctx }: Props) {
  const [r, g, b] = ctx.estimated_white_point;
  return (
    <section className="px-2 py-1.5 border-b border-separator">
      <div className="text-[9px] uppercase tracking-wide text-text-secondary mb-1.5">
        Color
      </div>
      {ctx.color_palette.length > 0 && (
        <div className="flex h-4 mb-2 rounded-sm overflow-hidden">
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
      <Row k="White point">
        <span className="flex items-center gap-1 text-text-primary">
          <Swatch rgb={ctx.estimated_white_point} size={10} />
          <span className="tabular-nums">rgb({Math.round(r)}, {Math.round(g)}, {Math.round(b)})</span>
        </span>
      </Row>
      <Row k="WB confidence">
        <span className="text-text-primary tabular-nums">{(ctx.wb_neutral_confidence * 100).toFixed(0)}%</span>
      </Row>
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
    <div className="mt-2">
      <div className="text-[9px] text-text-secondary mb-1">Color cast (a*/b*)</div>
      <div
        className="relative bg-surface-secondary rounded-sm"
        style={{ width: CAST_BOX_SIZE, height: CAST_BOX_SIZE }}
      >
        <div className="absolute top-1/2 left-0 right-0 h-px bg-separator" />
        <div className="absolute top-0 bottom-0 left-1/2 w-px bg-separator" />
        <div
          className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-accent"
          style={{ left: x, top: y, opacity: strength }}
        />
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-[10px] mb-0.5">
      <span className="text-text-secondary">{k}</span>
      {children}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
