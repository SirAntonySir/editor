import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { extractObjectToImageNode } from '@/lib/segmentation/object-actions';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  maskId: z.string().describe('Object/mask id, from list_objects.'),
  imageNodeId: z.string().optional().describe('Source image-node. Defaults to the Object\'s recorded owner.'),
});

export const extractObjectToImageNodeTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'extract_object_to_image_node',
  kind: 'mutate',
  description:
    'Bake the masked region of the Object into a new image-node placed next to the source. The new node carries a single image layer with the cutout pixels.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ maskId, imageNodeId }) => {
    if (!maskStore.has(maskId)) {
      return { ok: false, message: `No Object with id "${maskId}".` };
    }
    const sourceImageNodeId =
      imageNodeId ?? objectOwnership.get(maskId) ?? useEditorStore.getState().activeImageNodeId ?? undefined;
    if (!sourceImageNodeId) {
      return { ok: false, message: 'Could not resolve source image-node for the Object.' };
    }
    extractObjectToImageNode(maskId, sourceImageNodeId);
    return { ok: true, message: `Extracted Object "${maskId}" to a new image-node.` };
  },
};
