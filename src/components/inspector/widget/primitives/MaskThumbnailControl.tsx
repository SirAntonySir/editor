import type { MaskThumbnailSchema, MaskSummary } from '@/types/widget';

interface MaskThumbnailControlProps {
  label: string;
  value: string;
  default: string;
  schema: MaskThumbnailSchema;
  onChange: (value: string) => void;
  maskSummaries: MaskSummary[];
}

/** Read-only label/preview for a single mask. The `onChange` prop is part
 *  of the uniform primitive interface but is never called. */
export function MaskThumbnailControl({ label, value, maskSummaries }: MaskThumbnailControlProps) {
  const mask = maskSummaries.find((m) => m.id === value);
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-primary">{label}</span>
      <span className="text-text-secondary">{mask?.label ?? `(${value.slice(0, 8)})`}</span>
    </div>
  );
}
