import { z } from 'zod';
import { useEditorStore } from '@/store';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input.');

const output = z.object({
  layers: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      name: z.string(),
      isActive: z.boolean(),
      adjustmentCount: z.number(),
    }),
  ),
});

export const listLayersTool: ToolManifest<typeof input, typeof output> = {
  name: 'list_layers',
  kind: 'query',
  description:
    'List the layers in the current document. Most documents have a single image layer; this matters when the LLM needs to apply different adjustments to different layers.',
  inputSchema: input,
  outputSchema: output,
  handler: () => {
    const s = useEditorStore.getState();
    return {
      layers: s.layers.map((l) => ({
        id: l.id,
        type: l.type,
        name: l.name ?? l.type,
        isActive: l.id === s.activeLayerId,
        adjustmentCount: l.adjustmentStack?.adjustments.length ?? 0,
      })),
    };
  },
};
