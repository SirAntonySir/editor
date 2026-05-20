import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input.');

const output = z.object({
  hasSelection: z.boolean(),
  state: z.enum(['active', 'committed', 'none']),
  label: z.string().nullable().describe('Region label if the selection came from a Claude-named region.'),
  width: z.number().optional(),
  height: z.number().optional(),
  source: z.string().optional().describe('Provenance: sam-point, sam-box, ai-proposed, brush, …'),
});

export const getActiveSelectionTool: ToolManifest<typeof input, typeof output> = {
  name: 'get_active_selection',
  kind: 'query',
  description:
    'Inspect the currently armed selection. Use this before calling select_* tools to avoid clobbering a useful selection, or to find out the label of what is currently in scope.',
  inputSchema: input,
  outputSchema: output,
  handler: () => {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) {
      return { hasSelection: false, state: 'none' as const, label: null };
    }
    const mask = maskStore.get(ref);
    return {
      hasSelection: true,
      state: s.activeMaskRef ? ('active' as const) : ('committed' as const),
      label: mask?.label ?? null,
      width: mask?.width,
      height: mask?.height,
      source: mask?.source,
    };
  },
};
