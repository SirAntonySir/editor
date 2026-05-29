interface Props {
  rgb: [number, number, number];
  size?: number;
}

export function Swatch({ rgb, size = 16 }: Props) {
  const [r, g, b] = rgb;
  return (
    <div
      title={toHex(r, g, b)}
      style={{
        width: size,
        height: size,
        backgroundColor: `rgb(${r}, ${g}, ${b})`,
        borderRadius: 2,
      }}
    />
  );
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
