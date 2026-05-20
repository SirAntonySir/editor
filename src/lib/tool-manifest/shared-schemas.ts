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

/**
 * Control-binding shape for `propose_panel`. Mirrors the panel-binding
 * schema already in use by the AI panel system (`src/store/ai-panel-actions`).
 * Kept loose here so new control types added in Plan 4 don't require
 * editing the tool manifest.
 */
export const panelBindingSchema = z.object({
  paramKey: z.string().describe('Stable identifier for this control within the panel.'),
  label: z.string().describe('Human-readable label shown next to the control.'),
  control: z.enum(['slider', 'choice', 'toggle']).describe('Control type rendered in the UI.'),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.union([z.number(), z.string(), z.boolean()]).describe('Initial value the user sees.'),
  reasoning: z.string().optional().describe('One sentence explaining why this control is offered.'),
});
export type PanelBindingInput = z.infer<typeof panelBindingSchema>;

/** Common acknowledgement shape — many mutating tools just need ok/error. */
export const ackSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type Ack = z.infer<typeof ackSchema>;
