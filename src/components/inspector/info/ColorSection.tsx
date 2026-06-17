import { Palette, Pin } from 'lucide-react';
import type { ImageContext } from '@/types/image-context';
import { Swatch } from '@/components/ui/Swatch';
import { ColorCastPlot } from '@/components/ui/ColorCastPlot';
import { SectionHeader } from './SectionHeader';
import { useEditorStore } from '@/store';
import { editorDocument } from '@/core/document';
import { toast } from '@/components/ui/Toast';

interface Props {
  ctx: ImageContext;
}

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
          <div className="text-[10px] text-text-secondary mb-1">Color cast (a*/b*)</div>
          <ColorCastPlot
            a={ctx.castDirection[0]}
            b={ctx.castDirection[1]}
            strength={ctx.castStrength!}
          />
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

function hex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}
