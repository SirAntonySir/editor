type PreviewKind = 'thumbnail' | 'histogram_delta' | 'color_swatches' | 'none';

interface PreviewSlotProps {
  kind: PreviewKind;
}

export function PreviewSlot({ kind }: PreviewSlotProps) {
  if (kind === 'none') return null;
  if (kind === 'histogram_delta') {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
        <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Δ</span>
        <div
          aria-label="Histogram delta preview"
          className="flex-1 h-6 bg-surface-secondary border border-separator rounded-[3px]"
        />
      </div>
    );
  }
  if (kind === 'thumbnail') {
    return (
      <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
        <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Preview</span>
        <div
          aria-label="Thumbnail preview"
          className="flex-1 h-10 bg-surface-secondary border border-separator rounded-[3px]"
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 border-b border-separator">
      <span className="text-[8px] text-text-secondary uppercase tracking-wide flex-none">Palette</span>
      <div
        aria-label="Color swatches preview"
        className="flex-1 h-4 flex gap-0.5"
      >
        {[0,1,2,3].map((i) => (
          <span key={i} className="flex-1 h-4 bg-surface-secondary border border-separator rounded-[2px]" />
        ))}
      </div>
    </div>
  );
}
