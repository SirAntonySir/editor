import { useRef } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useEditorStore } from '@/store';

interface AdjustmentSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
}: AdjustmentSliderProps) {
  const display = formatValue ? formatValue(value) : String(Math.round(value));
  const dragging = useRef(false);

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
    // Trigger one final write so zundo captures the committed value
    onChange(v);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs text-text-secondary tabular-nums w-10 text-right">{display}</span>
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
        />
      </Slider.Root>
    </div>
  );
}
