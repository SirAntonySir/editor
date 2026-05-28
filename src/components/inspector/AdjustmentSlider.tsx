import { useRef, useState, useEffect } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { editorDocument } from '@/core/document';

interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
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
}: AdjustmentSliderProps) {
  const display = formatValue ? formatValue(value) : String(Math.round(value));
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const resetValue = defaultValue ?? (min + max) / 2;

  const handleValueChange = ([v]: number[]) => {
    onChange(v);
  };

  const handleValueCommit = ([v]: number[]) => {
    onChange(v);
    editorDocument.endInteraction();
  };

  const handleLabelClick = () => {
    setEditValue(String(Math.round(value * 100) / 100));
    setEditing(true);
  };

  const commitEdit = () => {
    setEditing(false);
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      onChange(Math.max(min, Math.min(max, parsed)));
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
            className="text-[9px] text-text-secondary tabular-nums w-8 text-right cursor-text hover:text-text-primary transition-colors"
            onClick={handleLabelClick}
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
        onDoubleClick={() => onChange(resetValue)}
      >
        <Slider.Track className="relative h-1.5 grow rounded-sm bg-surface-secondary overflow-hidden">
          <Slider.Range
            className="absolute h-full rounded-sm"
            style={{
              background: `linear-gradient(90deg,
                color-mix(in srgb, var(--color-accent) 55%, transparent),
                var(--color-accent))`,
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
