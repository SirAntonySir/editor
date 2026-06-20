import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { convertObjectToLayerMask } from '@/lib/segmentation/object-actions';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  maskId: z.string().describe('Object/mask id, from list_objects.'),
  imageNodeId: z.string().optional().describe('Source image-node. Defaults to the Object\'s recorded owner.'),
});

export const convertObjectToLayerMaskTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'convert_object_to_layer_mask',
  kind: 'mutate',
  description:
    'Duplicate the source layer, apply the Object\'s mask as the duplicate\'s layerMask, and append it to the image-node. The original layer is untouched.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ maskId, imageNodeId }) => {
    if (!maskStore.has(maskId)) {
      return { ok: false, message: `No Object with id "${maskId}".` };
    }
    const sourceImageNodeId =
      imageNodeId ?? objectOwnership.get(maskId) ?? useEditorStore.getState().activeImageNodeId ?? undefined;
    convertObjectToLayerMask(maskId, sourceImageNodeId);
    return { ok: true, message: `Converted Object "${maskId}" to a layer mask on a new layer.` };
  },
};
