import { z } from 'zod';
import { useEditorStore } from '@/store';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({}).describe('No input — clears both active and committed selections.');

export const clearSelectionTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'clear_selection',
  kind: 'mutate',
  description:
    'Discard the currently armed selection. Call between unrelated operations so the next adjustment does not accidentally inherit the previous scope.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: () => {
    useEditorStore.getState().setActiveMask(null);
    useEditorStore.getState().discardCommittedMask();
    return { ok: true };
  },
};
