import { z } from 'zod';

/**
 * Higher-level scope vocabulary the LLM uses. Translated to the internal
 * `Scope` type (`src/types/scope.ts`) inside handlers — the LLM never
 * speaks in `maskRef` UUIDs directly.
 */
export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('global'),
  }).describe('Apply to the entire image (no mask).'),
  z.object({
    kind: z.literal('active_selection'),
  }).describe('Apply to whatever mask is currently armed in the selection state.'),
  z.object({
    kind: z.literal('named_region'),
    label: z.string().min(1).describe('Region label as returned by list_named_regions.'),
  }).describe('Apply to a Claude-named region (e.g. "subject", "sky").'),
]);
export type ScopeInput = z.infer<typeof scopeSchema>;

/** Common acknowledgement shape — many mutating tools just need ok/error. */
export const ackSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type Ack = z.infer<typeof ackSchema>;
