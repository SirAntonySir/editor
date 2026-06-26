import { describe, expect, it } from 'vitest';
import { extractAttachedObjectIds } from './CommandPalette.agent-helpers';

describe('extractAttachedObjectIds', () => {
  it('pulls object/mask ids from object-flavored chips, ignores others', () => {
    const ids = extractAttachedObjectIds([
      { sourceId: 'region:object:mask_sky' },
      { sourceId: 'region:ai:tree' },
      { sourceId: 'imageNode:in-1' },
      {},
    ]);
    expect(ids).toEqual(['mask_sky', 'tree']);
  });
});
