import * as Slider from '@radix-ui/react-slider';

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
        onValueChange={([v]) => onChange(v)}
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
