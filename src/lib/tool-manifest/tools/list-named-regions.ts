import { z } from 'zod';
import { useAiSession } from '@/hooks/useImageContext';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input.');

const regionSummary = z.object({
  label: z.string(),
  description: z.string().optional(),
  hasMask: z.boolean().describe('True if this region has a registered mask ready for select_named_region.'),
});

const output = z.object({
  regions: z.array(regionSummary),
});

export const listNamedRegionsTool: ToolManifest<typeof input, typeof output> = {
  name: 'list_named_regions',
  kind: 'query',
  description:
    'List the Claude-named candidate regions identified in the current image (e.g. "subject", "sky", "background"). These labels are the LLM\'s primary vocabulary for selection — prefer these over raw coordinates.',
  inputSchema: input,
  outputSchema: output,
  handler: () => {
    const ctx = useAiSession.getState().context;
    const regions = ctx?.candidateRegions ?? [];
    return {
      regions: regions.map((r) => ({
        label: r.label,
        description: r.description,
        hasMask: !!r.maskRef,
      })),
    };
  },
};
