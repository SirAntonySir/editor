import { Palette, Pin } from 'lucide-react';
import type { ImageContext } from '@/types/image-context';
import { Swatch } from '@/components/ui/Swatch';
import { SectionHeader } from './SectionHeader';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';

interface Props {
  ctx: ImageContext;
}

// Lab a*/b* are theoretically unbounded but typical natural images stay
// within ±50. Beyond that we clamp.
const AB_RANGE = 50;
// Bumped from the original 56 — at that size the chart was visually a
// thumbnail, hard to read a position from. 96 fits the inspector column
// width and gives the gradient enough room to read as colour space.
const CAST_BOX_SIZE = 96;

export function ColorSection({ ctx }: Props) {
  // Streaming-aware: palette + cast arrive on the mechanical delta; white
  // point + WB confidence land on the soft-fields delta. Render whatever's
  // present, hold the rest as compact skeleton lines so the section grows
  // into place rather than reflowing when soft arrives.
  const hasWhitePoint = Array.isArray(ctx.estimatedWhitePoint);
  const [r, g, b] = hasWhitePoint ? ctx.estimatedWhitePoint! : [0, 0, 0];

  function pinAt(): { position: { x: number; y: number }; targetImageNodeId?: string } {
    const editor = useEditorStore.getState();
    const activeId = editor.activeImageNodeId;
    const node = activeId ? editor.imageNodes[activeId] : undefined;
    return {
      position: node
        ? { x: node.position.x + node.size.w + 32, y: node.position.y }
        : { x: 200, y: 200 },
      targetImageNodeId: activeId ?? undefined,
    };
  }

  function pinPalette() {
    if (!ctx.colorPalette || ctx.colorPalette.length === 0) return;
    editorDocument.workspace.addInfoNode(
      {
        kind: 'palette',
        palette: {
          swatches: ctx.colorPalette.map((s) => ({
            rgb: [s.rgb[0], s.rgb[1], s.rgb[2]] as [number, number, number],
            weight: s.weight,
          })),
        },
      },
      { ...pinAt(), title: 'Palette' },
    );
    toast.info('Pinned palette');
  }

  function pinCast() {
    if (!ctx.castDirection) return;
    editorDocument.workspace.addInfoNode(
      {
        kind: 'cast',
        cast: { a: ctx.castDirection[0], b: ctx.castDirection[1], strength: ctx.castStrength ?? 0 },
      },
      { ...pinAt(), title: 'Color cast' },
    );
    toast.info('Pinned color cast');
  }

  return (
    <section className="px-3 py-2.5">
      <SectionHeader icon={Palette} label="Color" />
      {(ctx.colorPalette?.length ?? 0) > 0 && (
        <div className="relative group flex h-5 mb-2.5 rounded-[3px] overflow-hidden border border-separator">
          {ctx.colorPalette!.map((s, i) => (
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
          <button
            type="button"
            onClick={pinPalette}
            title="Pin palette as canvas widget"
            aria-label="Pin palette"
            className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100
              focus-visible:opacity-100 transition-opacity
              text-text-secondary hover:text-text-primary
              bg-surface/85 backdrop-blur-sm border border-separator
              rounded-[3px] p-0.5"
          >
            <Pin size={10} aria-hidden />
          </button>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mb-2">
        <dt className="text-[10px] text-text-secondary">White point</dt>
        <dd className="text-[10px] text-text-primary text-right">
          {hasWhitePoint ? (
            <span className="inline-flex items-center gap-1">
              <Swatch rgb={ctx.estimatedWhitePoint!} size={10} />
              <span className="tabular-nums">rgb({Math.round(r)}, {Math.round(g)}, {Math.round(b)})</span>
            </span>
          ) : (
            <span className="inline-block w-20 h-2.5 rounded-sm bg-surface-secondary" aria-hidden />
          )}
        </dd>
        <dt className="text-[10px] text-text-secondary">WB confidence</dt>
        <dd className="text-[10px] text-text-primary text-right tabular-nums">
          {typeof ctx.wbNeutralConfidence === 'number' ? (
            `${(ctx.wbNeutralConfidence * 100).toFixed(0)}%`
          ) : (
            <span className="inline-block w-10 h-2.5 rounded-sm bg-surface-secondary" aria-hidden />
          )}
        </dd>
      </dl>
      {(ctx.castStrength ?? 0) > 0 && ctx.castDirection && (
        <div className="relative group">
          <CastDot direction={ctx.castDirection} strength={ctx.castStrength!} />
          <button
            type="button"
            onClick={pinCast}
            title="Pin color cast as canvas widget"
            aria-label="Pin color cast"
            className="absolute top-0 right-0 opacity-0 group-hover:opacity-100
              focus-visible:opacity-100 transition-opacity
              text-text-secondary hover:text-text-primary
              bg-surface/85 backdrop-blur-sm border border-separator
              rounded-[3px] p-0.5"
          >
            <Pin size={11} aria-hidden />
          </button>
        </div>
      )}
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
      <div className="flex items-stretch gap-3">
        {/* 2D Lab a-star / b-star plot. a: green (left, negative) to red
            (right, positive). b: blue (top, negative) to yellow (bottom,
            positive). Two crossed linear gradients with `multiply` blending
            approximate the in-plane colour at each coordinate — close enough
            for a "where is the cast pointing" read without a per-pixel
            canvas shader. Axis labels sit just outside the plot so the
            colour space is self-explanatory on a quick glance. */}
        <div className="relative flex-none">
          <div
            className="relative rounded-[3px] border border-separator overflow-hidden"
            style={{
              width: CAST_BOX_SIZE,
              height: CAST_BOX_SIZE,
              background:
                'linear-gradient(to right, hsl(140 45% 60%) 0%, hsl(0 0% 92%) 50%, hsl(0 65% 60%) 100%),' +
                'linear-gradient(to bottom, hsl(220 60% 65%) 0%, hsl(0 0% 92%) 50%, hsl(48 75% 60%) 100%)',
              backgroundBlendMode: 'multiply',
            }}
          >
            {/* Crosshair axes through the neutral midpoint. */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-text-primary/20" />
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-text-primary/20" />
            <div
              className="absolute size-2.5 -ml-[5px] -mt-[5px] rounded-full
                bg-text-primary border-2 border-surface shadow-sm"
              style={{ left: x, top: y, opacity: Math.min(1, 0.5 + strength * 0.5) }}
            />
          </div>
          {/* Axis labels — placed just outside the plot, dimmed so they
              don't fight with the gradient. */}
          <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full
            text-[9px] text-text-secondary leading-none">b−</span>
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 translate-y-full
            text-[9px] text-text-secondary leading-none">b+</span>
          <span className="absolute top-1/2 -left-0.5 -translate-y-1/2 -translate-x-full
            text-[9px] text-text-secondary leading-none">a−</span>
          <span className="absolute top-1/2 -right-0.5 -translate-y-1/2 translate-x-full
            text-[9px] text-text-secondary leading-none">a+</span>
        </div>
        {/* Values column — grid pulls labels left, values right; flex-1 +
            min-w-0 lets it claim every pixel the chart doesn't use. */}
        <dl className="flex-1 min-w-0 grid grid-cols-[auto_1fr] auto-rows-min content-center
          gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
          <dt className="text-text-secondary">a*</dt>
          <dd className="text-text-primary text-right">{ax.toFixed(1)}</dd>
          <dt className="text-text-secondary">b*</dt>
          <dd className="text-text-primary text-right">{ay.toFixed(1)}</dd>
          <dt className="text-text-secondary">strength</dt>
          <dd className="text-text-primary text-right">{(strength * 100).toFixed(0)}%</dd>
        </dl>
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
