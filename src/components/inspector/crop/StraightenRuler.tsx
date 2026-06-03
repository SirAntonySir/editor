import { useRef } from 'react';
import { RotateCcw } from 'lucide-react';

interface StraightenRulerProps {
  value: number;        // current angle in degrees, range [-45, 45]
  onChange: (angle: number) => void;
  min?: number;
  max?: number;
  /** Snap to 0 when within this many degrees of it. */
  snapZero?: number;
}

export function StraightenRuler({
  value, onChange, min = -45, max = 45, snapZero = 0.5,
}: StraightenRulerProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Convert pointer X (within the track) → angle.
  function angleFromPointer(clientX: number): number {
    const track = trackRef.current;
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, ratio));
    let angle = min + clamped * (max - min);
    if (Math.abs(angle) <= snapZero) angle = 0;
    return parseFloat(angle.toFixed(1));
  }

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    onChange(angleFromPointer(e.clientX));
    function onMove(ev: PointerEvent) {
      onChange(angleFromPointer(ev.clientX));
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const range = max - min;
  const thumbPct = ((value - min) / range) * 100;
  const centerPct = ((0 - min) / range) * 100;

  return (
    <div className="flex flex-col gap-1.5" data-testid="straighten-ruler">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] text-text-secondary">Straighten</span>
        <div className="flex items-center gap-2">
          <span className="num text-[11px] font-medium text-text-primary tabular-nums">
            {value > 0 ? '+' : ''}{value.toFixed(1)}°
          </span>
          <button
            type="button"
            aria-label="Reset straighten"
            disabled={value === 0}
            onClick={() => onChange(0)}
            className="inline-flex items-center justify-center w-4 h-4 rounded-[3px] text-text-tertiary hover:text-text-primary hover:bg-surface-secondary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={10} aria-hidden />
          </button>
        </div>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Straighten"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={startDrag}
        className="relative h-7 rounded-[4px] bg-surface-secondary border border-separator cursor-ew-resize overflow-hidden"
      >
        {/* Minor tick marks every 5° (= 5/90 = 5.5556% spacing) */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, transparent 0, transparent calc(5.5555% - 1px), var(--color-separator) calc(5.5555% - 1px), var(--color-separator) 5.5555%)',
          }}
        />
        {/* Major tick marks every 15° (= 15/90 = 16.6667%) */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'repeating-linear-gradient(to right, transparent 0, transparent calc(16.6666% - 1px), var(--color-border-strong) calc(16.6666% - 1px), var(--color-border-strong) 16.6666%)',
          }}
        />
        {/* Center line at 0° */}
        <div
          className="absolute top-0 bottom-0 w-px bg-accent"
          style={{ left: `${centerPct}%` }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1 bottom-1 w-[3px] bg-white rounded-[1px]"
          style={{ left: `calc(${thumbPct}% - 1.5px)`, boxShadow: '0 0 0 1px rgba(0,0,0,0.4)' }}
        />
      </div>
      <div className="flex justify-between text-[8px] text-text-tertiary tabular-nums px-px">
        <span>−45</span><span>−30</span><span>−15</span><span>0</span><span>+15</span><span>+30</span><span>+45</span>
      </div>
    </div>
  );
}
