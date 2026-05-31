import { useRef, useState, useEffect } from 'react';
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
  defaultValue?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  /** Colour-codes the fill; defaults to 'hand' (accent) for legacy callers. */
  provenance?: SliderProvenance;
  /** Called when an interaction ends (scrub/track release, text commit). */
  onCommit?: () => void;
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
  onChange,
  formatValue,
  provenance = 'hand',
  onCommit,
}: AdjustmentSliderProps) {
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

  return (
    <div className="flex flex-col gap-0.5" data-no-drag>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-text-secondary truncate">{label}</span>
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
        <Slider.Track className="relative h-0.5 grow rounded-sm bg-surface-secondary overflow-hidden">
          <Slider.Range
            className="absolute h-full rounded-sm"
            style={{
              background: `linear-gradient(90deg,
                color-mix(in srgb, ${fillColor} 55%, transparent),
                ${fillColor})`,
              width: `${fillPct}%`,
            }}
          />
        </Slider.Track>
        {/* Invisible thumb — Radix needs it for keyboard / aria, but we
            hide it visually for the minimal pill look. */}
        <Slider.Thumb
          className="block w-3 h-3 -ml-1.5 opacity-0 focus:opacity-0 focus-visible:opacity-0"
          aria-label={label}
        />
      </Slider.Root>
    </div>
  );
}
