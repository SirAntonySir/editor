// 2D Lab a*/b* plot with crossed-gradient background, axis labels, and
// a values column. Used by the Info tab (ColorSection) and by the
// `cast` InfoWidget. Lab a*/b* are theoretically unbounded but typical
// natural images stay within ±50; we clamp beyond that.

const AB_RANGE = 50;

interface Props {
  /** Lab a* (green ↔ red) and b* (blue ↔ yellow) cast direction. */
  a: number;
  b: number;
  /** 0–1; controls indicator dot opacity. */
  strength: number;
  /** Plot edge length in px. Default sized for inspector column. */
  size?: number;
}

export function ColorCastPlot({ a, b, strength, size = 96 }: Props) {
  const ax = clamp(a, -AB_RANGE, AB_RANGE);
  const ay = clamp(b, -AB_RANGE, AB_RANGE);
  const x = ((ax + AB_RANGE) / (2 * AB_RANGE)) * size;
  const y = ((ay + AB_RANGE) / (2 * AB_RANGE)) * size;
  return (
    <div className="flex items-stretch gap-3">
      {/* a: green (left, negative) to red (right, positive). b: blue
          (top, negative) to yellow (bottom, positive). Two crossed
          linear gradients with `multiply` blending approximate the
          in-plane colour at each coordinate — close enough for a
          "where is the cast pointing" read without a per-pixel
          canvas shader. Axis labels sit just outside the plot. */}
      <div className="relative flex-none">
        <div
          className="relative rounded-[3px] border border-separator overflow-hidden"
          style={{
            width: size,
            height: size,
            background:
              'linear-gradient(to right, hsl(140 45% 60%) 0%, hsl(0 0% 92%) 50%, hsl(0 65% 60%) 100%),' +
              'linear-gradient(to bottom, hsl(220 60% 65%) 0%, hsl(0 0% 92%) 50%, hsl(48 75% 60%) 100%)',
            backgroundBlendMode: 'multiply',
          }}
        >
          <div className="absolute top-1/2 left-0 right-0 h-px bg-text-primary/20" />
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-text-primary/20" />
          <div
            className="absolute size-2.5 -ml-[5px] -mt-[5px] rounded-full
              bg-text-primary border-2 border-surface shadow-sm"
            style={{ left: x, top: y, opacity: Math.min(1, 0.5 + strength * 0.5) }}
          />
        </div>
        <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full
          text-[9px] text-text-secondary leading-none">b−</span>
        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 translate-y-full
          text-[9px] text-text-secondary leading-none">b+</span>
        <span className="absolute top-1/2 -left-0.5 -translate-y-1/2 -translate-x-full
          text-[9px] text-text-secondary leading-none">a−</span>
        <span className="absolute top-1/2 -right-0.5 -translate-y-1/2 translate-x-full
          text-[9px] text-text-secondary leading-none">a+</span>
      </div>
      <dl className="flex-1 min-w-0 grid grid-cols-[auto_1fr] auto-rows-min content-center
        gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
        <dt className="text-text-secondary">a*</dt>
        <dd className="text-text-primary text-right">{ax.toFixed(1)}</dd>
        <dt className="text-text-secondary">b*</dt>
        <dd className="text-text-primary text-right">{ay.toFixed(1)}</dd>
        <dt className="text-text-secondary">strength</dt>
        <dd className="text-text-primary text-right">{(strength * 100).toFixed(0)}%</dd>
      </dl>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
