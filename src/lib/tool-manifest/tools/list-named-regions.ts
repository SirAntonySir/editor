import { z } from 'zod';
import { useAiSession } from '@/hooks/useImageContext';
import { maskStore } from '@/core/mask-store';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input.');

const regionSummary = z.object({
  label: z.string(),
  origin: z.enum(['object', 'ai_region']).describe('Whether this entry is a committed Object or an AI-proposed candidate region.'),
  description: z.string().optional(),
  hasMask: z.boolean().describe('True if this region has a registered mask ready for select_named_region.'),
  maskId: z.string().optional().describe('Present when origin is "object" — the committed mask id.'),
  maskRef: z.string().optional().describe('Present when origin is "ai_region" and a mask ref is available.'),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

const output = z.object({
  regions: z.array(regionSummary),
});

export const listNamedRegionsTool: ToolManifest<typeof input, typeof output> = {
  name: 'list_named_regions',
  kind: 'query',
  description:
    'List the named regions available for selection: committed Objects (with a persisted mask) and Claude-proposed candidate regions. Objects are listed first and win on duplicate label. Use select_named_region to arm one.',
  inputSchema: input,
  outputSchema: output,
  handler: () => {
    // Build merged map: lowercased label → entry. Objects win on duplicate.
    const merged = new Map<string, z.infer<typeof regionSummary>>();

    // 1. Insert committed Objects (origin: 'object').
    for (const mask of maskStore.all()) {
      if (!mask.label) continue;
      const key = mask.label.toLowerCase();
      merged.set(key, {
        label: mask.label,
        origin: 'object',
        hasMask: true,
        maskId: mask.id,
      });
    }

    // 2. Insert AI regions (origin: 'ai_region') only if label not already present.
    const ctx = useAiSession.getState().context;
    for (const r of ctx?.candidateRegions ?? []) {
      const key = r.label.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, {
          label: r.label,
          origin: 'ai_region',
          description: r.description,
          hasMask: !!r.maskRef,
          maskRef: r.maskRef ?? undefined,
        });
      }
    }

    return { regions: Array.from(merged.values()) };
  },
};
