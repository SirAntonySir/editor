import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { copyObjectToImageNode } from '@/lib/segmentation/object-actions';
import type { ToolManifest } from '../types';

const input = z.object({
  maskId: z.string().describe('Object/mask id, from list_objects.'),
  imageNodeId: z.string().optional().describe('Source image-node. Defaults to the Object\'s recorded owner.'),
});

const output = z.object({
  ok: z.boolean(),
  image_node_id: z.string().optional().describe('The new image node carrying the cutout.'),
  layer_ids: z.array(z.string()).optional().describe('Layer ids of the new node (pass to propose_adjustment_widgets).'),
  message: z.string().optional(),
});

export const copyObjectToImageNodeTool: ToolManifest<typeof input, typeof output> = {
  name: 'copy_object_to_image_node',
  kind: 'mutate',
  description:
    'Bake the masked region of the Object into a new image-node placed next to the source. '
    + 'Returns the new image_node_id + layer_ids — pass them to propose_adjustment_widgets to edit it.',
  inputSchema: input,
  outputSchema: output,
  handler: ({ maskId, imageNodeId }) => {
    if (!maskStore.has(maskId)) {
      return { ok: false, message: `No Object with id "${maskId}".` };
    }
    const sourceImageNodeId =
      imageNodeId ?? objectOwnership.get(maskId) ?? useEditorStore.getState().activeImageNodeId ?? undefined;
    if (!sourceImageNodeId) {
      return { ok: false, message: 'Could not resolve source image-node for the Object.' };
    }
    // LLM-invoked extraction: the agent proposes its own widgets on the new
    // node next — pending suggestion chips must not be cloned along.
    const extracted = copyObjectToImageNode(maskId, sourceImageNodeId, {
      excludePendingSuggestions: true,
    });
    if (!extracted) {
      return { ok: false, message: `Could not extract Object "${maskId}".` };
    }
    return { ok: true, image_node_id: extracted.imageNodeId, layer_ids: [extracted.layerId] };
  },
};
