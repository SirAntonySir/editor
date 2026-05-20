import { z } from 'zod';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { ProcessingRegistry } from '@/lib/processing-registry';
import { addAiStepNode } from '@/store/ai-panel-actions';
import { ackSchema, scopeSchema, panelBindingSchema, type ScopeInput } from '../shared-schemas';
import type { ToolManifest } from '../types';
import type { Scope } from '@/types/scope';
import type { OperationGraph } from '@/types/operation-graph';

const input = z.object({
  intent: z.string().describe('Short human-readable description of the user-facing intent (e.g. "warm up subject", "subtler grade"). Becomes the panel\'s headline.'),
  scope: scopeSchema,
  kind: z.string().describe('Processing kind for the underlying adjustment node (e.g. "kelvin", "curves", "saturation").'),
  defaultParams: z.record(z.union([z.number(), z.string(), z.boolean()])).describe('Starting parameter values for the node. The user can dial them via the bindings below.'),
  bindings: z.array(panelBindingSchema).min(1).describe('UI controls the user can adjust. At least one binding required.'),
  reasoning: z.string().optional().describe('One-sentence rationale shown beneath the panel — "why did the LLM propose this?"'),
});

let panelCounter = 0;
function newPanelId(): string {
  return `panel-${Date.now()}-${++panelCounter}`;
}

function resolveScope(scopeInput: ScopeInput): Scope | null {
  if (scopeInput.kind === 'global') return { kind: 'global' };
  if (scopeInput.kind === 'active_selection') {
    const s = useEditorStore.getState();
    const ref = s.activeMaskRef ?? s.committedMaskRef;
    if (!ref) return null;
    return { kind: 'mask', maskRef: ref };
  }
  const ctx = useAiSession.getState().context;
  const region = ctx?.candidateRegions?.find((r) => r.label === scopeInput.label);
  if (!region?.maskRef) return null;
  return { kind: 'mask', maskRef: region.maskRef };
}

export const proposePanelTool: ToolManifest<typeof input, typeof ackSchema> = {
  name: 'propose_panel',
  kind: 'emit',
  description:
    'Hand the user an interactive panel rather than acting irreversibly. Use this when the decision is subjective (mood, grading, stylistic choices) — the user dials in the final value via your bindings.',
  usage:
    'Each binding ties one panel control to one node parameter. Provide sensible defaults so the panel is useful even if the user accepts without dialling.',
  inputSchema: input,
  outputSchema: ackSchema,
  handler: ({ intent, scope, kind, defaultParams, bindings, reasoning }) => {
    const definition = ProcessingRegistry.get(kind);
    if (!definition) {
      return { ok: false, message: `Unknown adjustment kind "${kind}". Valid kinds: ${ProcessingRegistry.getAll().map((d) => d.adjustmentType).join(', ')}.` };
    }
    const resolved = resolveScope(scope);
    if (!resolved) {
      return { ok: false, message: `Could not resolve scope ${JSON.stringify(scope)}.` };
    }

    const state = useEditorStore.getState();
    const layerId = state.activeLayerId ?? state.layers.find((l) => l.type === 'image')?.id;
    if (!layerId) return { ok: false, message: 'No image layer for panel.' };

    const nodeId = 'n1';
    const graph: OperationGraph = {
      id: newPanelId(),
      userGoal: intent,
      reasoning,
      nodes: [
        {
          id: nodeId,
          type: definition.adjustmentType,
          scope: resolved,
          params: defaultParams,
          inputs: [],
        },
      ],
      panelBindings: bindings.map((b) => ({
        nodeId,
        paramKey: b.paramKey,
        label: b.label,
        control: b.control === 'choice' ? 'picker' : b.control,
        min: b.min,
        max: b.max,
        step: b.step,
        default: b.default,
        reasoning: b.reasoning,
      })),
      metadata: {
        source: 'tool_manifest.propose_panel',
        generated_at: new Date().toISOString(),
      },
    };

    addAiStepNode({ kind: 'layer', layerId }, graph);
    return { ok: true, message: `Panel "${intent}" emitted with ${bindings.length} binding(s).` };
  },
};
