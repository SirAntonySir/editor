import type { Anchor } from '@/lib/perceptual-dial/types';
import { shaderKelvinToDisplayKelvin, KELVIN_NEUTRAL } from '@/lib/kelvin-direction';

const SLIDER_MAX = 1000; // Internal precision: 1/1000 → quick & smooth.

export interface PerceptualDialBodyProps {
  topology: '1d-slider' | '2d-pad';
  anchors: Anchor[];
  position: number; // 1-D: scalar in [0, 1]. (2-D handled in a follow-up.)
  onPositionChange: (t: number) => void;
}

export function PerceptualDialBody({ topology, anchors, position, onPositionChange }: PerceptualDialBodyProps) {
  if (topology !== '1d-slider') {
    // 2-D pad is added in the Mood Pad plan.
    return null;
  }

  const gradient = buildKelvinGradient(anchors);
  const value = Math.round(clamp01(position) * SLIDER_MAX);

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <div
        data-testid="dial-gradient-strip"
        className="h-4 rounded-[var(--radius-button)]"
        style={{ background: gradient }}
      />
      <input
        type="range"
        min={0}
        max={SLIDER_MAX}
        step={1}
        value={value}
        onChange={(e) => onPositionChange(parseInt(e.target.value, 10) / SLIDER_MAX)}
        className="w-full accent-[var(--color-accent)]"
        aria-label="Time of day"
      />
      <div className="flex justify-between text-[9px] uppercase tracking-wide text-text-secondary">
        {[...anchors].sort((a, b) => a.position[0] - b.position[0]).map((a) => (
          <span key={a.id}>{a.label}</span>
        ))}
      </div>
    </div>
  );
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Build a CSS linear-gradient string from `kelvin.kelvin` values across anchors.
 * Anchors store kelvin in the shader convention (high = warmer apparent image);
 * we reflect through the SSoT helper to get the perceptual colour for display.
 */
function buildKelvinGradient(anchors: Anchor[]): string {
  const sorted = [...anchors].sort((a, b) => a.position[0] - b.position[0]);
  const stops = sorted.map((a) => {
    const stored = (a.params['kelvin.kelvin'] as number | undefined) ?? KELVIN_NEUTRAL;
    return `${kelvinToRgb(shaderKelvinToDisplayKelvin(stored))} ${(a.position[0] * 100).toFixed(1)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Convert kelvin → CSS `rgb(...)` approximation (Krystek/Tanner). */
function kelvinToRgb(k: number): string {
  const clamped = Math.max(1000, Math.min(12000, k)) / 100;
  let r: number, g: number, b: number;
  if (clamped <= 66) {
    r = 255;
    g = clamped <= 2 ? 0 : clamp(99.4708025861 * Math.log(clamped) - 161.1195681661, 0, 255);
    b = clamped >= 66 ? 255 : (clamped <= 19 ? 0 : clamp(138.5177312231 * Math.log(clamped - 10) - 305.0447927307, 0, 255));
  } else {
    r = clamp(329.698727446 * Math.pow(clamped - 60, -0.1332047592), 0, 255);
    g = clamp(288.1221695283 * Math.pow(clamped - 60, -0.0755148492), 0, 255);
    b = 255;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
