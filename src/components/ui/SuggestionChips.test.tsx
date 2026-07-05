import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SuggestionChips } from './SuggestionChips';
import { makeAiWidget, makeGlobalWidget } from '@/components/widget/__fixtures__/widgets';
import type { Widget } from '@/types/widget';

// ── Mocks ────────────────────────────────────────────────────────────
const deleteWidget = vi.fn();
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { delete_widget: (...a: unknown[]) => deleteWidget(...a) },
}));

const runAgentTurnForRegion = vi.fn();
vi.mock('@/lib/palette-actions.agent', () => ({
  runAgentTurnForRegion: (...a: unknown[]) => runAgentTurnForRegion(...a),
}));

const tether = vi.fn();
vi.mock('@/lib/workspace-tether', () => ({
  tetherWorkspaceWidgetOnEngage: (...a: unknown[]) => tether(...a),
}));

vi.mock('@/lib/ai-access', () => ({ useAiAccess: () => true }));

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }) }),
}));

// Backend snapshot: which widgets exist. Swapped per test.
let widgets: Widget[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const backendState = (): any => ({ sessionId: 's-1', snapshot: { widgets, revision: 1 } });
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selector: (s: any) => any) => selector(backendState()),
    { getState: () => backendState() },
  ),
}));

// Suggestions-ui store: mark every widget pending; capture the action fns.
const resolvePending = vi.fn();
const addAccepted = vi.fn();
const recordDecision = vi.fn();
const setPreview = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const suggestionsState = (): any => ({
  pendingSuggestionIds: new Set(widgets.map((w) => w.id)),
  previewingSuggestionIds: new Set<string>(),
  acceptedSuggestions: new Set<string>(),
  suggestionHistory: [],
  resolvePending,
  addAcceptedSuggestion: addAccepted,
  recordSuggestionDecision: recordDecision,
  setPreview,
});
vi.mock('@/store/suggestions-ui-slice', () => ({
  useSuggestionsUi: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selector: (s: any) => any) => selector(suggestionsState()),
    { getState: () => suggestionsState() },
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  widgets = [];
});

function allowButton(intent: string) {
  return screen.getByRole('button', { name: new RegExp(`Allow suggestion: ${intent}`, 'i') });
}

describe('SuggestionChips — allow', () => {
  it('extracts a named_region suggestion into a SAM node instead of full-image tether', async () => {
    runAgentTurnForRegion.mockResolvedValue({ extracted: true, ok: true, toolCalls: 2 });
    widgets = [makeAiWidget({ intent: 'Sneakers lost in shadow', scope: { kind: 'named_region', label: 'hanging sneakers' } })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Sneakers lost in shadow'));

    await waitFor(() =>
      expect(runAgentTurnForRegion).toHaveBeenCalledWith('Sneakers lost in shadow', 'hanging sneakers'),
    );
    expect(deleteWidget).toHaveBeenCalledWith('s-1', { widgetId: 'w-ai-1', suppressSimilar: false });
    expect(tether).not.toHaveBeenCalled();
    // Marked accepted so useAutoTetherAiSuggestions won't tether the original
    // whole-image widget in the window before delete_widget's SSE lands.
    expect(addAccepted).toHaveBeenCalledWith('w-ai-1');
    expect(resolvePending).toHaveBeenCalledWith('w-ai-1');
  });

  it('falls back to full-image tether when the region cannot be extracted', async () => {
    runAgentTurnForRegion.mockResolvedValue({ extracted: false, ok: true, toolCalls: 0 });
    widgets = [makeAiWidget({ intent: 'Sneakers lost in shadow', scope: { kind: 'named_region', label: 'hanging sneakers' } })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Sneakers lost in shadow'));

    await waitFor(() => expect(tether).toHaveBeenCalledTimes(1));
    expect(deleteWidget).not.toHaveBeenCalled();
    expect(addAccepted).toHaveBeenCalledWith('w-ai-1');
    expect(resolvePending).toHaveBeenCalledWith('w-ai-1');
  });

  it('tethers a global-scope suggestion directly (no extraction)', async () => {
    widgets = [makeGlobalWidget({ intent: 'Tighten midtone contrast' })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Tighten midtone contrast'));

    await waitFor(() => expect(tether).toHaveBeenCalledTimes(1));
    expect(runAgentTurnForRegion).not.toHaveBeenCalled();
  });
});
