import { useRef, useState, useEffect } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useEditorStore } from '@/store';

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
  const dragging = useRef(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const resetValue = defaultValue ?? (min + max) / 2;

  const handleValueChange = ([v]: number[]) => {
    if (!dragging.current) {
      dragging.current = true;
      useEditorStore.temporal.getState().pause();
    }
    onChange(v);
  };

  const handleValueCommit = ([v]: number[]) => {
    dragging.current = false;
    const temporal = useEditorStore.temporal.getState();
    temporal.resume();
    onChange(v);
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

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
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
            className="w-14 text-right text-xs tabular-nums bg-surface-secondary border border-separator rounded-sm px-1 py-0 text-text-primary outline-none focus:border-accent"
          />
        ) : (
          <span
            className="text-xs text-text-secondary tabular-nums w-10 text-right cursor-text hover:text-text-primary transition-colors"
            onClick={handleLabelClick}
          >
            {display}
          </span>
        )}
      </div>
      <Slider.Root
        className="relative flex items-center select-none touch-none h-4"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
      >
        <Slider.Track className="relative h-[3px] grow rounded-full bg-separator">
          <Slider.Range className="absolute h-full rounded-full bg-accent" />
        </Slider.Track>
        <Slider.Thumb
          className="block w-3.5 h-3.5 rounded-full bg-white shadow-button border border-separator
            focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
            transition-transform hover:scale-110"
          onDoubleClick={() => onChange(resetValue)}
        />
      </Slider.Root>
    </div>
  );
}
