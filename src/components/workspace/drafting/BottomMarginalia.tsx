interface BottomMarginaliaProps {
  sourceWidth: number;
  sourceHeight: number;
  /** Short mime tag (JPEG / PNG / RAW). */
  formatLabel: string;
  /** Pretty-printed file size like "4.2 MB", or null if unknown. */
  fileSize: string | null;
  layerCount: number;
  objectCount: number;
}

/**
 * Bottom chrome rendered beneath the image node. Renders a single
 * Geist-Mono caps row:
 *
 *     1013 × 1350 PX  ·  JPEG  ·  4.2 MB  ·  04 LAYERS  ·  03 OBJECTS
 *
 * Numerals carry `text-text-primary`; labels carry `text-text-secondary`
 * so the eye lands on the numbers first. The "objects" segment is
 * suppressed when the count is zero — the spec calls out that "Objects · 0"
 * read as broken UI in the classic footer.
 */
export function BottomMarginalia({
  sourceWidth,
  sourceHeight,
  formatLabel,
  fileSize,
  layerCount,
  objectCount,
}: BottomMarginaliaProps) {
  const layerCountStr = layerCount.toString().padStart(2, '0');
  const objectCountStr = objectCount.toString().padStart(2, '0');

  return (
    <div
      data-testid="bottom-marginalia"
      className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-[var(--font-mono)] text-[10px] tracking-[0.18em] uppercase text-text-secondary"
    >
      <span>
        <span className="text-text-primary tabular-nums">{sourceWidth}</span>
        {' × '}
        <span className="text-text-primary tabular-nums">{sourceHeight}</span>
        {' PX'}
      </span>
      <Sep />
      <span>{formatLabel}</span>
      {fileSize && (
        <>
          <Sep />
          <span className="text-text-primary tabular-nums">{fileSize}</span>
        </>
      )}
      <Sep />
      <span>
        <span className="text-text-primary tabular-nums">{layerCountStr}</span>
        {' '}Layers
      </span>
      {objectCount > 0 && (
        <>
          <Sep />
          <span>
            <span className="text-text-primary tabular-nums">{objectCountStr}</span>
            {' '}Objects
          </span>
        </>
      )}
    </div>
  );
}

function Sep() {
  return (
    <span
      aria-hidden
      className="inline-block w-[3px] h-[3px] rounded-full bg-text-secondary/60"
    />
  );
}
