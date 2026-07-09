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
      expect(runAgentTurnForRegion).toHaveBeenCalledWith(
        'Sneakers lost in shadow', 'hanging sneakers', undefined,
        { sourceImageNodeId: undefined },
      ),
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

describe('SuggestionChips — source-node resolution', () => {
  it("passes the suggestion's OWN image node, not the active one (back-to-back accepts)", async () => {
    // Accepting suggestion #1 extracts a cutout and makes it active. The
    // second accept must still segment from the SOURCE image the suggestion
    // was minted against — its node resolves via the widget's target layer.
    const { useEditorStore } = await import('@/store');
    useEditorStore.getState().resetWorkspace();
    const sourceId = useEditorStore.getState().addImageNode(['l-src']);
    const cutoutId = useEditorStore.getState().addImageNode(['l-cut']);
    useEditorStore.getState().setActiveImageNode(cutoutId);

    runAgentTurnForRegion.mockResolvedValue({ extracted: true, ok: true, toolCalls: 1 });
    widgets = [makeAiWidget({
      intent: 'Car body lost in shadow',
      scope: { kind: 'named_region', label: 'sports car' },
      nodes: [{ id: 'n-1', type: 'basic', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w-ai-1', layerId: 'l-src' }] as never,
    })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Car body lost in shadow'));

    await waitFor(() =>
      expect(runAgentTurnForRegion).toHaveBeenCalledWith(
        'Car body lost in shadow', 'sports car', undefined,
        { sourceImageNodeId: sourceId },
      ),
    );
  });
});

describe('SuggestionChips — allow re-entry & failure', () => {
  it('ignores re-clicks while the region agent turn is in flight (single-flight)', async () => {
    // Agent turn hangs until we resolve it — models the multi-second
    // Node/Layer chooser + extraction + LLM turn.
    let finish!: (v: { extracted: boolean; ok: boolean; toolCalls: number }) => void;
    runAgentTurnForRegion.mockImplementation(
      () => new Promise((res) => { finish = res; }),
    );
    widgets = [makeAiWidget({ intent: 'Sneakers lost in shadow', scope: { kind: 'named_region', label: 'hanging sneakers' } })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Sneakers lost in shadow'));
    await waitFor(() => expect(runAgentTurnForRegion).toHaveBeenCalledTimes(1));
    // Impatient second + third click while the turn is still running.
    fireEvent.click(allowButton('Sneakers lost in shadow'));
    fireEvent.click(allowButton('Sneakers lost in shadow'));

    finish({ extracted: true, ok: true, toolCalls: 2 });
    await waitFor(() => expect(resolvePending).toHaveBeenCalledWith('w-ai-1'));

    // ONE turn, ONE widget stack — not one per click.
    expect(runAgentTurnForRegion).toHaveBeenCalledTimes(1);
    expect(resolvePending).toHaveBeenCalledTimes(1);
  });

  it('disables the allow button while the turn is in flight', async () => {
    runAgentTurnForRegion.mockImplementation(() => new Promise(() => {}));
    widgets = [makeAiWidget({ intent: 'Sneakers lost in shadow', scope: { kind: 'named_region', label: 'hanging sneakers' } })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Sneakers lost in shadow'));
    await waitFor(() =>
      expect(allowButton('Sneakers lost in shadow')).toHaveProperty('disabled', true),
    );
  });

  it('keeps the chip pending and re-enables on failure so the user can retry', async () => {
    runAgentTurnForRegion.mockRejectedValue(new Error('agent turn failed'));
    widgets = [makeAiWidget({ intent: 'Sneakers lost in shadow', scope: { kind: 'named_region', label: 'hanging sneakers' } })];
    render(<SuggestionChips />);

    fireEvent.click(allowButton('Sneakers lost in shadow'));

    // Failure: chip must NOT resolve out of pending (it would silently vanish
    // with no widget), and the button must come back for a retry.
    await waitFor(() =>
      expect(allowButton('Sneakers lost in shadow')).toHaveProperty('disabled', false),
    );
    expect(resolvePending).not.toHaveBeenCalled();
    expect(addAccepted).not.toHaveBeenCalled();
    expect(tether).not.toHaveBeenCalled();
  });
});
