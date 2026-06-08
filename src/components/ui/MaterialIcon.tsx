import { memo, type ComponentType, type CSSProperties } from 'react';

/**
 * Material Symbols (Outlined) icon — used for toolrail + processing-specific
 * icons. UI chrome (menus, close, chevrons, file ops) stays on Lucide.
 *
 * Renders the Material Symbols glyph via ligature lookup against the variable
 * font loaded in `index.html`. The wrapper API matches Lucide's `{ size?: number }`
 * so `ToolDefinition.icon` / `ProcessingDefinition.icon` stay interchangeable.
 */
interface MaterialIconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Override variable-font axes for this instance only. */
  weight?: number;
  fill?: 0 | 1;
}

interface CreateOpts {
  /** Per-icon weight axis override (300..700). Default 400 ≈ Lucide stroke. */
  weight?: number;
  /** Filled variant (1) vs outlined (0). Default 0. */
  fill?: 0 | 1;
}

interface GlyphProps extends MaterialIconProps {
  name: string;
  baseWeight: number;
  baseFill: 0 | 1;
}

const Glyph = memo(function Glyph({
  name,
  baseWeight,
  baseFill,
  size = 16,
  className,
  style,
  weight,
  fill,
}: GlyphProps) {
  const w = weight ?? baseWeight;
  const f = fill ?? baseFill;
  return (
    <span
      className={`material-symbol${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        fontSize: size,
        width: size,
        height: size,
        fontVariationSettings: `'FILL' ${f}, 'wght' ${w}, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
    >
      {name}
    </span>
  );
});

export function createMaterialIcon(
  name: string,
  opts: CreateOpts = {},
): ComponentType<MaterialIconProps> {
  const baseWeight = opts.weight ?? 400;
  const baseFill = opts.fill ?? 0;
  return memo((props: MaterialIconProps) => (
    <Glyph name={name} baseWeight={baseWeight} baseFill={baseFill} {...props} />
  ));
}
