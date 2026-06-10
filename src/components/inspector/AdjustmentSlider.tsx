import { useRef, useState, useEffect, type ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { editorDocument } from '@/core/document';

/** Provenance of the current value — drives the fill colour.
 *  default = untouched (grey) · ai = an AI/fused widget set it (violet) ·
 *  hand = the user moved it (accent blue). */
export type SliderProvenance = 'default' | 'ai' | 'hand';

interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Used by the double-click Reset. For AI-suggestion bindings this is
   *  the resolved AI value (so Reset returns to the AI's pick, not engine
   *  neutral). For tool / canonical sliders it's the engine neutral. */
  defaultValue?: number;
  /** True ENGINE-canonical neutral — the value the slider sits at when no
   *  adjustment has been applied. Drives the tick mark. Falls back to
   *  `defaultValue` when omitted (back-compat for callers where Reset and
   *  neutral are the same, e.g. the toolrail sliders). */
  neutralValue?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  /** Colour-codes the fill; defaults to 'hand' (accent) for legacy callers. */
  provenance?: SliderProvenance;
  /** Called when an interaction ends (scrub/track release, text commit). */
  onCommit?: () => void;
  /**
   * When set, the track shows this CSS gradient instead of the fill-from-min
   * style, and the thumb becomes a visible dot whose border carries provenance.
   * Used by colour-meaningful bipolar controls (HSL). Omitted → unchanged.
   */
  trackGradient?: string;
  /**
   * Optional ReactNode rendered immediately after the label (left side of
   * the row, before the value). Used by the per-slider Pin menu — the
   * primitive doesn't know about pins, callers supply the affordance.
   */
  pinSlot?: ReactNode;
}

function fillColorFor(provenance: SliderProvenance): string {
  if (provenance === 'ai') return 'var(--color-ai)';
  if (provenance === 'default') return 'var(--color-text-secondary)';
  return 'var(--color-accent)';
}

export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  neutralValue,
  onChange,
  formatValue,
  provenance = 'hand',
  onCommit,
  trackGradient,
  pinSlot,
}: AdjustmentSliderProps) {
  const colorTrack = trackGradient != null;
  const display = formatValue ? formatValue(value) : String(Math.round(value));
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks an in-progress number-scrub: start pointer x, start value, whether
  // it moved past the click threshold (so pointerup can tell scrub from click).
  const scrub = useRef<{ startX: number; startVal: number; moved: boolean } | null>(null);

  const resetValue = defaultValue ?? (min + max) / 2;

  const handleValueChange = ([v]: number[]) => {
    onChange(v);
  };

  const handleValueCommit = ([v]: number[]) => {
    onChange(v);
    onCommit?.();
    editorDocument.endInteraction();
  };

  const beginEdit = () => {
    setEditValue(String(Math.round(value * 100) / 100));
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
      onCommit?.();
    }
  };

  // --- number-scrub: drag the value horizontally to change it ---------------
  const snap = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    return step ? Math.round(clamped / step) * step : clamped;
  };

  const onNumPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (editing) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrub.current = { startX: e.clientX, startVal: value, moved: false };
  };

  const onNumPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    if (!s.moved && Math.abs(dx) < 3) return;
    s.moved = true;
    // 200px of travel spans the full range; Shift = fine (¼ speed).
    const perPx = ((max - min) / 200) * (e.shiftKey ? 0.25 : 1);
    onChange(snap(s.startVal + dx * perPx));
  };

  const onNumPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current;
    scrub.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (s && !s.moved) {
      beginEdit(); // it was a click, not a drag
    } else if (s) {
      onCommit?.();
      editorDocument.endInteraction();
    }
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Fill width as percentage of track for the minimal style.
  const fillPct = ((value - min) / (max - min || 1)) * 100;
  const fillColor = fillColorFor(provenance);

  // Neutral tick: render a small vertical mark on the track at the ENGINE-
  // canonical neutral whenever that point sits STRICTLY between min and
  // max — i.e. it's a bipolar slider (HSL, kelvin, contrast, etc.) where
  // the neutral isn't at the leftmost end. Skips sliders whose neutral is
  // 0 on a [0, 100] range (sharpen amount, clarity amount) — the rail end
  // already reads as neutral. `neutralValue` is the engine baseline
  // independent of any AI suggestion; falls back to `defaultValue` only
  // when no explicit neutral was passed (toolrail sliders).
  const tickValue = neutralValue ?? defaultValue;
  const tickPct =
    tickValue != null && tickValue > min && tickValue < max
      ? ((tickValue - min) / (max - min)) * 100
      : null;

  return (
    <div className="group flex flex-col gap-0.5" data-no-drag>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-secondary truncate min-w-0">{label}</span>
        {pinSlot}
        <span className="flex-1" />
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="w-10 text-right text-[10px] tabular-nums bg-surface-secondary border border-separator rounded-sm px-1 py-0 text-text-primary outline-none focus:border-accent"
          />
        ) : (
          <span
            className="text-[9px] text-text-secondary tabular-nums num w-8 text-right cursor-ew-resize select-none hover:text-text-primary transition-colors"
            title="Drag to scrub · click to type"
            onPointerDown={onNumPointerDown}
            onPointerMove={onNumPointerMove}
            onPointerUp={onNumPointerUp}
          >{display}</span>
        )}
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none h-3 cursor-pointer"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        onDoubleClick={() => { onChange(resetValue); onCommit?.(); }}
      >
        <Slider.Track
          className={`relative grow rounded-sm overflow-hidden ${colorTrack ? 'h-[3px]' : 'h-0.5 bg-surface-secondary'}`}
          style={colorTrack ? { background: trackGradient } : undefined}
        >
          {!colorTrack && (
            <Slider.Range
              className="absolute h-full rounded-sm"
              style={{
                background: `linear-gradient(90deg,
                  color-mix(in srgb, ${fillColor} 55%, transparent),
                  ${fillColor})`,
                width: `${fillPct}%`,
              }}
            />
          )}
        </Slider.Track>
        {/* Neutral tick — sits on top of the track at the engine-canonical
            neutral, slightly taller than the track itself so it reads as
            an anchor mark rather than a chunk of the rail. */}
        {tickPct !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-2 bg-text-secondary/50 rounded-full"
            style={{ left: `${tickPct}%` }}
          />
        )}
        {/* Default: invisible thumb (Radix needs it for keyboard / aria) and the
            fill carries provenance. Colour track: a visible dot whose border
            carries provenance, since the track itself is now the colour. */}
        <Slider.Thumb
          className={
            colorTrack
              ? 'block w-2 h-2 -ml-1 rounded-full bg-surface border-2'
              : 'block w-3 h-3 -ml-1.5 opacity-0 focus:opacity-0 focus-visible:opacity-0'
          }
          style={colorTrack ? { borderColor: fillColor } : undefined}
          aria-label={label}
        />
      </Slider.Root>
    </div>
  );
}
