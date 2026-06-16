/**
 * Four hairline L-shapes at the image corners. Identifies the image-node
 * frame when the node is not selected. On select, a sibling `.frame`
 * border fades in via CSS transition (handled in ImageNodeDrafting), the
 * ticks stay underneath as a reference layer.
 *
 * The L size + offset (14px arms, -7px outset from the corner) mirror the
 * mockup at docs/mockups/image-node-restyle.html so the visual proportions
 * port cleanly.
 */
export function CornerTicks() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      data-testid="image-node-corner-ticks"
    >
      <span className="absolute -top-[7px] -left-[7px]  block w-[14px] h-[14px] border border-[var(--color-accent)] border-r-0 border-b-0" />
      <span className="absolute -top-[7px] -right-[7px] block w-[14px] h-[14px] border border-[var(--color-accent)] border-l-0 border-b-0" />
      <span className="absolute -bottom-[7px] -left-[7px]  block w-[14px] h-[14px] border border-[var(--color-accent)] border-r-0 border-t-0" />
      <span className="absolute -bottom-[7px] -right-[7px] block w-[14px] h-[14px] border border-[var(--color-accent)] border-l-0 border-t-0" />
    </div>
  );
}
