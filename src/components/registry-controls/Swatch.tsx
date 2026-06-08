import { Swatch as SwatchPrimitive } from '@/components/ui/Swatch';
import type { RegistryControlProps } from './Slider';

/**
 * Swatch — handles `color_hsv` params.
 * v1: renders a colour preview swatch alongside a native <input type="color">
 * picker. Converts the [h, s, v] tuple to/from a hex string for the input.
 *
 * TODO: replace the native color picker with a proper HSV/HSL popover picker
 *       that round-trips the [h,s,v] tuple without lossy hex conversion.
 */

/** Convert HSV [0-360, 0-1, 0-1] → RGB [0-255, 0-255, 0-255] */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hi = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const [r, g, b] = table[hi];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Convert RGB [0-255] → hex string "#rrggbb" */
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Convert hex "#rrggbb" → HSV [0-360, 0-1, 0-1] */
function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = h * 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return [h, s, max];
}

function isHsvTuple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
}

export function Swatch({ schema, value, onChange, label, disabled }: RegistryControlProps) {
  void schema; // color_hsv params have no extra constraints beyond type
  const hsv = isHsvTuple(value) ? value : [0, 0, 1] as [number, number, number];
  const rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);
  const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);

  function handleHexChange(next: string) {
    onChange(hexToHsv(next));
  }

  return (
    <div className={`flex items-center justify-between gap-2${disabled ? ' pointer-events-none opacity-40' : ''}`}>
      <span className="text-[10px] text-text-secondary truncate">{label}</span>
      <div className="flex items-center gap-1.5">
        <SwatchPrimitive rgb={rgb} size={16} />
        <input
          aria-label={label}
          type="color"
          value={hex}
          onChange={(e) => handleHexChange(e.target.value)}
          className="w-6 h-4 rounded cursor-pointer border-none bg-transparent p-0"
        />
      </div>
    </div>
  );
}
