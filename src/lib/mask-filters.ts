import type { MaskSummary } from '@/types/widget';

/**
 * True when `mask` should be visible given the currently active image node.
 *
 * A mask with no `imageNodeId` is treated as global (legacy data, or a
 * deliberately session-wide mask) and is always visible. A mask targeted
 * to a specific image node is hidden when a different node is active;
 * visible when its node is active or no node is active at all.
 */
export function maskMatchesImageNode(
  mask: Pick<MaskSummary, 'imageNodeId'>,
  activeImageNodeId: string | null,
): boolean {
  if (!mask.imageNodeId) return true;
  if (!activeImageNodeId) return true;
  return mask.imageNodeId === activeImageNodeId;
}
