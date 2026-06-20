import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import type { ToolManifest } from '../types';

const input = z.object({
  imageNodeId: z.string().optional().describe('Filter to one image-node. Defaults to the active image-node.'),
});

const output = z.object({
  objects: z.array(z.object({
    id: z.string(),
    label: z.string().optional(),
    layerId: z.string(),
    imageNodeId: z.string(),
    width: z.number(),
    height: z.number(),
  })),
});

export const listObjectsTool: ToolManifest<typeof input, typeof output> = {
  name: 'list_objects',
  kind: 'query',
  description:
    'Returns the committed Objects (user-saved segmentation masks) currently in the document. Prefer this over list_named_regions when the user has segmented something — Objects are persistent and addressable by id.',
  inputSchema: input,
  outputSchema: output,
  handler: ({ imageNodeId }) => {
    const editor = useEditorStore.getState();
    const targetNode = imageNodeId ?? editor.activeImageNodeId ?? undefined;
    const objects = maskStore.all()
      .filter((m) => (targetNode ? objectOwnership.get(m.id) === targetNode : true))
      .map((m) => ({
        id: m.id,
        label: m.label,
        layerId: m.layerId,
        imageNodeId: objectOwnership.get(m.id) ?? '',
        width: m.width,
        height: m.height,
      }));
    return { objects };
  },
};
