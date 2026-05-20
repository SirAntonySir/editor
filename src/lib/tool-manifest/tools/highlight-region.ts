import { z } from 'zod';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  label: z.string().describe('Region label as returned by list_named_regions.'),
  reasoning: z.string().optional().describe('Why are you pointing at this region? (Shown in the future annotation UI.)'),
});

export const highlightRegionTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'highlight_region',
  kind: 'emit',
  description:
    'Visually point at a region for the user without committing it as a selection-for-adjustment. Use this when you want the user to *look* at something — not when you want to act on it.',
  usage:
    'Currently implemented as a transient active-mask preview using the Plan 1 overlay substrate. Future work: dedicated annotation overlay layer with the reasoning text rendered alongside.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ label, reasoning }) => {
    const ctx = useAiSession.getState().context;
    const region = ctx?.candidateRegions?.find((r) => r.label === label);
    if (!region?.maskRef) {
      return { ok: false, message: `No region with label "${label}" has a mask.` };
    }
    // Arm as active (preview) only — don't commit. The overlay substrate will
    // render fill + marching-ants outline immediately.
    useEditorStore.getState().setActiveMask(region.maskRef);
    return {
      ok: true,
      message: reasoning ? `Highlighting "${label}": ${reasoning}` : `Highlighting "${label}".`,
    };
  },
};
