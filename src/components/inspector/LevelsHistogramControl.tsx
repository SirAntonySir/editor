import { useEffect, useRef, useState } from 'react';
import {
  computeHistogramBins,
  histogramPeak,
  type HistogramBins,
} from '@/lib/histogram-compute';

/**
 * Photoshop-style Levels widget: a luma+R/G/B histogram serves as the
 * track, with three draggable handles (black point, gamma midpoint, white
 * point) riding on top. Replaces the "chart + three slider rows" UI for
 * Levels, both in the toolrail section and in any AI Levels widget that
 * binds all three params.
 *
 * Handle math:
 *   - `inBlack` / `inWhite` in [0, 255] — drag the outer wedges to remap
 *     the input range.
 *   - `gamma` in [0.1, 3] — the centre wedge sits at the input value that
 *     gets mapped to 0.5 on output: x = inBlack + (inWhite - inBlack) *
 *     0.5^(1/gamma). Dragging it inverts that formula to update gamma.
 *
 * The histogram redraws when the `source` canvas reference changes — the
 * caller is expected to bump `source` only when underlying pixels move
 * (image swap, pipeline pass), not on every slider tick.
 */

interface Props {
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null;
  inBlack: number;
  inWhite: number;
  gamma: number;
  onInBlackChange: (v: number) => void;
  onInWhiteChange: (v: number) => void;
  onGammaChange: (v: number) => void;
  onCommit?: () => void;
  height?: number;
}

const MIN_GAP = 4; // keep handles from crossing on the input rail

type DragKind = 'black' | 'white' | 'gamma' | null;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Input value (in [inBlack, inWhite]) that maps to 0.5 output for the
 *  current gamma. Inverse: 0.5 = ((x - inBlack) / (inWhite - inBlack))^(1/gamma)
 *  →  x = inBlack + (inWhite - inBlack) * 0.5^gamma. */
function gammaInputValue(inBlack: number, inWhite: number, gamma: number): number {
  return inBlack + (inWhite - inBlack) * Math.pow(0.5, gamma);
}

function inverseGamma(inBlack: number, inWhite: number, x: number): number {
  const span = inWhite - inBlack;
  if (span <= 0) return 1;
  const t = clamp((x - inBlack) / span, 0.01, 0.99);
  return Math.log(t) / Math.log(0.5);
}

export function LevelsHistogramControl({
  source,
  inBlack,
  inWhite,
  gamma,
  onInBlackChange,
  onInWhiteChange,
  onGammaChange,
  onCommit,
  height = 80,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [bins, setBins] = useState<HistogramBins | null>(null);
  const [drag, setDrag] = useState<DragKind>(null);

  // Compute histogram bins when the source changes. Cheap (256×256 sample).
  useEffect(() => {
    if (!source) {
      setBins(null);
      return;
    }
    setBins(computeHistogramBins(source));
  }, [source]);

  // Build path data once per `bins` change so each handle-drag re-render
  // doesn't re-trace 256 lineTo commands.
  const peak = bins ? histogramPeak(bins) : 0;
  const buildPath = (ch: Uint32Array): string => {
    if (peak === 0) return '';
    const parts: string[] = ['M0,100'];
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 256;
      const y = 100 - Math.min(100, (ch[i] / peak) * 100);
      parts.push(`L${x},${y}`);
    }
    parts.push('L256,100', 'Z');
    return parts.join(' ');
  };

  function valueAtClientX(clientX: number): number {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clamp(clientX - rect.left, 0, rect.width);
    return Math.round((x / rect.width) * 255);
  }

  function onHandlePointerDown(kind: Exclude<DragKind, null>, e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(kind);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const v = valueAtClientX(e.clientX);
    if (drag === 'black') {
      onInBlackChange(clamp(v, 0, inWhite - MIN_GAP));
    } else if (drag === 'white') {
      onInWhiteChange(clamp(v, inBlack + MIN_GAP, 255));
    } else if (drag === 'gamma') {
      // Constrain gamma handle to the input range so the math stays sane.
      const x = clamp(v, inBlack + 1, inWhite - 1);
      onGammaChange(clamp(inverseGamma(inBlack, inWhite, x), 0.1, 3.0));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDrag(null);
    onCommit?.();
  }

  const blackPct = (inBlack / 255) * 100;
  const whitePct = (inWhite / 255) * 100;
  const gammaPct = (gammaInputValue(inBlack, inWhite, gamma) / 255) * 100;

  return (
    // gap-3 leaves room for the triangle handles that hang below the rail
    // (the handle wrapper is `top: calc(100% - 2px)` so it extends ~10px
    // past the histogram box).
    <div className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative w-full select-none rounded-[3px] bg-surface-secondary border border-separator"
        style={{ height }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Histogram — drawn behind the handles. */}
        <svg
          viewBox="0 0 256 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden
        >
          {bins && peak > 0 && (
            <>
              <path d={buildPath(bins.r)} fill="rgba(255, 68, 68, 0.35)" />
              <path d={buildPath(bins.g)} fill="rgba(68, 187, 68, 0.35)" />
              <path d={buildPath(bins.b)} fill="rgba(68, 136, 255, 0.35)" />
              <path d={buildPath(bins.lum)} fill="rgba(120, 120, 120, 0.45)" />
            </>
          )}
          {/* Clipped-zone overlays — anything outside [inBlack, inWhite] gets
              cut by the pipeline; tint those bands so the user sees it. */}
          {inBlack > 0 && (
            <rect x={0} y={0} width={(inBlack / 255) * 256} height={100} fill="color-mix(in srgb, var(--color-accent) 8%, transparent)" />
          )}
          {inWhite < 255 && (
            <rect x={(inWhite / 255) * 256} y={0} width={256 - (inWhite / 255) * 256} height={100} fill="color-mix(in srgb, var(--color-accent) 8%, transparent)" />
          )}
        </svg>

        {/* Subtle vertical guides at the endpoint handle positions. Dashed
            + low-opacity so the histogram colours stay legible behind them. */}
        <span
          className="pointer-events-none absolute top-1 bottom-2 w-px"
          style={{
            left: `${blackPct}%`,
            backgroundImage: 'linear-gradient(to bottom, var(--color-text-primary) 50%, transparent 50%)',
            backgroundSize: '1px 3px',
            opacity: 0.18,
          }}
        />
        <span
          className="pointer-events-none absolute top-1 bottom-2 w-px"
          style={{
            left: `${whitePct}%`,
            backgroundImage: 'linear-gradient(to bottom, var(--color-text-primary) 50%, transparent 50%)',
            backgroundSize: '1px 3px',
            opacity: 0.18,
          }}
        />

        {/* Three triangle handles sit just BELOW the rail with their apex
            on its bottom edge. */}
        <Handle pct={blackPct} kind="black" onPointerDown={(e) => onHandlePointerDown('black', e)} label="Black point" />
        <Handle pct={gammaPct} kind="gamma" onPointerDown={(e) => onHandlePointerDown('gamma', e)} label="Gamma" />
        <Handle pct={whitePct} kind="white" onPointerDown={(e) => onHandlePointerDown('white', e)} label="White point" />
      </div>
      {/* Numeric readouts below the rail — clickable to type a value via
          the standard AdjustmentSlider drag-to-scrub idiom would be a
          future enhancement; static for now. */}
      <div className="flex justify-between text-[9px] text-text-secondary tabular-nums px-0.5">
        <span>{Math.round(inBlack)}</span>
        <span>{gamma.toFixed(2)}</span>
        <span>{Math.round(inWhite)}</span>
      </div>
    </div>
  );
}

type HandleKind = 'black' | 'gamma' | 'white';

function Handle({
  pct,
  kind,
  onPointerDown,
  label,
}: {
  pct: number;
  kind: HandleKind;
  onPointerDown: (e: React.PointerEvent) => void;
  label: string;
}) {
  // Lightroom / Photoshop convention: filled dark triangle for the black
  // point, mid-grey filled for gamma, hollow (surface fill + dark outline)
  // for the white point. All three are stroked so they read against the
  // histogram colours behind them.
  const fill =
    kind === 'gamma' ? 'var(--color-text-secondary)'
      : kind === 'white' ? 'var(--color-surface)'
      : 'var(--color-text-primary)';
  // 5×4 SVG path apex (top-centre) → base corners. Tiny but tight.
  // Padding around the SVG gives a generous hit area without the visible
  // triangle bloating.
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      className="absolute -translate-x-1/2 cursor-ew-resize touch-none
        focus:outline-none focus-visible:ring-1 focus-visible:ring-accent
        rounded-sm p-1 -m-1 hover:[&_svg]:scale-110 active:[&_svg]:scale-110
        transition-transform"
      style={{ left: `${pct}%`, top: 'calc(100% - 2px)' }}
    >
      <svg
        width="10"
        height="8"
        viewBox="0 0 10 8"
        className="block transition-transform"
        aria-hidden
      >
        <polygon
          points="5,0 9,7 1,7"
          fill={fill}
          stroke="var(--color-text-primary)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
