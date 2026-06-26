/** Pull object/mask ids out of attached-context chips. Chips are sourced as
 *  `region:object:<maskId>` (committed objects) or `region:ai:<label>`
 *  (AI-proposed regions); both carry the identifier in the trailing segment.
 *  Non-region chips (e.g. `imageNode:...`) are ignored. */
export function extractAttachedObjectIds(
  items: Array<{ sourceId?: string }>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const src = item.sourceId ?? '';
    if (src.startsWith('region:object:')) out.push(src.slice('region:object:'.length));
    else if (src.startsWith('region:ai:')) out.push(src.slice('region:ai:'.length));
  }
  return out;
}
