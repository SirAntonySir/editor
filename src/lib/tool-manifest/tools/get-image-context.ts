import { z } from 'zod';
import { useAiSession } from '@/hooks/useImageContext';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input — returns the cached ImageContext.');

const output = z.object({
  available: z.boolean(),
  context: z.unknown().nullable().describe('The ImageContext object, or null if no image has been analysed yet.'),
});

export const getImageContextTool: ToolManifest<typeof input, typeof output> = {
  name: 'get_image_context',
  kind: 'query',
  description:
    'Read the cached image analysis (subjects, lighting, mood, dominant tones, candidate regions). Use this first to understand what kind of image you are editing.',
  inputSchema: input,
  outputSchema: output,
  handler: () => {
    const ctx = useAiSession.getState().context;
    return { available: ctx !== null, context: ctx ?? null };
  },
};
