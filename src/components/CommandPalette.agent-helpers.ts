import { extractObjectIds } from '@/lib/prompt-doc';

/** Pull object/mask ids out of attached-context chips. Chips are sourced as
 *  `region:object:<maskId>` (committed objects) or `region:ai:<label>`
 *  (AI-proposed regions); both carry the identifier in the trailing segment.
 *  Non-region chips (e.g. `imageNode:...`) are ignored.
 *
 *  Canonical implementation lives in `prompt-doc` so the inline-chip
 *  serialization and the legacy tray path stay in lock-step. */
export const extractAttachedObjectIds = extractObjectIds;
