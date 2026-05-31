export interface HistogramSeries {
  bins: number[];
  color: string;
  /** Filled area (default) vs stroked outline. */
  fill?: boolean;
}

interface Props {
  /** Single-series convenience API (filled). */
  bins?: number[];
  color?: string;
  /** Multi-series overlay; takes precedence over bins/color. All series share a
   *  common vertical scale so channel magnitudes stay comparable. */
  series?: HistogramSeries[];
  width?: number;
  height?: number;
}

export function Histogram({ bins, color, series, width = 120, height = 40 }: Props) {
  const resolved: HistogramSeries[] =
    series ?? (bins ? [{ bins, color: color ?? 'currentColor', fill: true }] : []);
  const max = resolved.reduce(
    (m, s) => s.bins.reduce((mm, v) => (v > mm ? v : mm), m),
    0,
  );
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {resolved.map((s, i) =>
        s.fill === false ? (
          <path
            key={i}
            d={buildLinePath(s.bins, width, height, max)}
            fill="none"
            stroke={s.color}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : (
          <path key={i} d={buildAreaPath(s.bins, width, height, max)} fill={s.color} />
        ),
      )}
    </svg>
  );
}

function buildAreaPath(bins: number[], width: number, height: number, max: number): string {
  if (bins.length === 0) return '';
  if (max === 0) {
    // Flat baseline — no peaks but a valid closed path.
    return `M0,${height} L${width},${height} Z`;
  }
  const stepX = width / bins.length;
  const parts: string[] = [`M0,${height}`];
  bins.forEach((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    parts.push(`L${x},${y}`);
  });
  parts.push(`L${width},${height}`, 'Z');
  return parts.join(' ');
}

function buildLinePath(bins: number[], width: number, height: number, max: number): string {
  if (bins.length === 0) return '';
  if (max === 0) return `M0,${height} L${width},${height}`;
  const stepX = width / bins.length;
  const parts: string[] = [];
  bins.forEach((v, i) => {
    const x = i * stepX;
    const y = height - (v / max) * height;
    parts.push(`${i === 0 ? 'M' : 'L'}${x},${y}`);
  });
  return parts.join(' ');
}
