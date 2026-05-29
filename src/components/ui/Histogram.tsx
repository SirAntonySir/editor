interface Props {
  bins: number[];
  color: string;
  width?: number;
  height?: number;
}

export function Histogram({ bins, color, width = 120, height = 40 }: Props) {
  const d = buildPath(bins, width, height);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <path d={d} fill={color} />
    </svg>
  );
}

function buildPath(bins: number[], width: number, height: number): string {
  if (bins.length === 0) return '';
  const max = bins.reduce((m, v) => (v > m ? v : m), 0);
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
