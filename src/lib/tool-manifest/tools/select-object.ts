import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  maskId: z.string().describe('Object/mask id, from list_objects.'),
});

export const selectObjectTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'select_object',
  kind: 'mutate',
  description:
    'Set an Object as the active selection. Subsequent propose_stack calls bind their scope to this Object\'s mask.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ maskId }) => {
    if (!maskStore.has(maskId)) {
      return { ok: false, message: `No Object with id "${maskId}". Call list_objects to see available ids.` };
    }
    useEditorStore.getState().setActiveObjectId(maskId);
    return { ok: true, message: `Selected Object "${maskId}".` };
  },
};
