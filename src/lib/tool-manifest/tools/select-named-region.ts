import { z } from 'zod';
import { useAiSession } from '@/hooks/useImageContext';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  label: z.string().min(1).describe('Region or Object label.'),
  commit: z.boolean().default(true).describe('If true (default), the mask is committed immediately (selection is locked). If false, it stays in active/preview state.'),
});

export const selectNamedRegionTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'select_named_region',
  kind: 'mutate',
  description:
    'Arm a named region/Object as the active selection. Prefers a committed Object with this label (instant); falls back to an AI-proposed region (creates a candidate). Always prefer this over raw coordinate-based segmentation when a name covers the goal.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ label, commit }) => {
    // 1. Try committed Object by label.
    const matchingObject = maskStore
      .all()
      .find((m) => m.label && m.label.toLowerCase() === label.toLowerCase());
    if (matchingObject) {
      useEditorStore.getState().setActiveObjectId(matchingObject.id);
      return { ok: true, message: `Selected Object "${matchingObject.label}".` };
    }
    // 2. Fall back to AI-precomputed region.
    const ctx = useAiSession.getState().context;
    const region = ctx?.candidateRegions?.find((r) => r.label.toLowerCase() === label.toLowerCase());
    if (!region) {
      return { ok: false, message: `No region or Object with label "${label}". Call list_named_regions to see what is available.` };
    }
    if (!region.maskRef) {
      return { ok: false, message: `Region "${label}" exists but has no mask. The image may have been analysed without segmentation.` };
    }
    useEditorStore.getState().setActiveMask(region.maskRef);
    if (commit) useEditorStore.getState().commitMask();
    return { ok: true, message: `Selected region "${label}" (${commit ? 'committed' : 'preview'}).` };
  },
};
