import { z } from 'zod';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  label: z.string().min(1).describe('Region label as returned by list_named_regions.'),
  commit: z.boolean().default(true).describe('If true (default), the mask is committed immediately (selection is locked). If false, it stays in active/preview state.'),
});

export const selectNamedRegionTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'select_named_region',
  kind: 'mutate',
  description:
    'Arm a Claude-named region as the active selection. Always prefer this over raw coordinate-based segmentation when a named region covers the goal — it is instant (no SAM call) and semantically meaningful.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ label, commit }) => {
    const ctx = useAiSession.getState().context;
    const region = ctx?.candidateRegions?.find((r) => r.label === label);
    if (!region) {
      return { ok: false, message: `No region with label "${label}". Call list_named_regions to see what is available.` };
    }
    if (!region.maskRef) {
      return { ok: false, message: `Region "${label}" exists but has no mask. The image may have been analysed without segmentation.` };
    }
    useEditorStore.getState().setActiveMask(region.maskRef);
    if (commit) useEditorStore.getState().commitMask();
    return { ok: true, message: `Selected "${label}" (${commit ? 'committed' : 'preview'}).` };
  },
};
