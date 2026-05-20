import { z } from 'zod';
import { ackSchema } from '../shared-schemas';
import type { ToolManifest } from '../types';

const input = z.object({
  text: z.string().min(1).describe('The note content. Keep it short — single sentence is ideal.'),
  anchor: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('region'), label: z.string() }),
      z.object({ kind: z.literal('point'), x: z.number(), y: z.number() }),
      z.object({ kind: z.literal('image') }),
    ])
    .describe('Where the note sits in the document.'),
});

/**
 * Module-level notes log. A future canvas annotation overlay (Plan 1 ext.
 * or Plan 4) will subscribe to this and render labels in image space.
 * Persisting via console + array keeps the LLM-side API stable until then.
 */
interface Note {
  id: string;
  text: string;
  anchor: z.infer<typeof input>['anchor'];
  createdAt: number;
}
const notes: Note[] = [];
export function getNotes(): readonly Note[] {
  return notes;
}

let noteCounter = 0;

export const addNoteTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'add_note',
  kind: 'emit',
  description:
    'Leave a short note anchored to a region, point, or the whole image. Use this to record reasoning the user should be able to see ("this dark area is the subject\'s face — I avoided over-brightening it").',
  usage:
    'Notes are stored and exposed via getNotes() — visual rendering on the canvas is a later step. The LLM-facing API is stable.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ text, anchor }) => {
    notes.push({ id: `note-${++noteCounter}`, text, anchor, createdAt: Date.now() });
    return { ok: true, message: `Note recorded (${notes.length} total).` };
  },
};
