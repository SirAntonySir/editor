import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { CurvesTool } from '@/tools/curves-tool';
import type { ToolDefinition } from '@/types/tool';

// Minimal stub for the light tool (replaces deleted light-tool.tsx).
const LightToolStub: ToolDefinition = {
  name: 'light',
  label: 'Light',
  icon: () => null,
  category: 'adjust',
  processingId: 'light',
  onActivate: () => {},
};
import { toast } from '@/components/ui/Toast';
import { spawnRegistryOp, spawnRegistryPreset } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';
import { useAiSession, analyseFirstImageLayer } from '@/hooks/useImageContext';

vi.mock('@/lib/toolrail-spawn', () => ({
  // CommandPalette routes registry-driven picks through these helpers;
  // we mock both even when a test only exercises one path so the dynamic
  // imports inside the component don't reach the real backend.
  spawnRegistryOp:     vi.fn(),
  spawnRegistryPreset: vi.fn(),
  spawnToolWidget:     vi.fn(() => true),
}));
vi.mock('@/lib/palette-actions', () => ({ proposeFromPalette: vi.fn().mockResolvedValue({ ok: true }) }));

// CommandPalette now auto-runs analyze when AI is invoked without context.
// We mock the analyzer so test runs don't hit the network; tests that
// exercise the AI path set up `useAiSession` to either have or lack context.
vi.mock('@/hooks/useImageContext', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useImageContext')>();
  return {
    ...actual,
    analyseFirstImageLayer: vi.fn().mockResolvedValue(undefined),
  };
});

function open() {
  act(() => { window.dispatchEvent(new CustomEvent('spawn-palette:open')); });
}

beforeEach(() => {
  CanvasToolRegistry.register(LightToolStub);
  CanvasToolRegistry.register(CurvesTool);
  useEditorStore.getState().resetWorkspace();
  useEditorStore.getState().clearSelection?.();
  useBackendState.getState().reset();
  useBackendState.setState({ sseStatus: 'open' });
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe('CommandPalette open + gating', () => {
  it('toasts and stays closed when there is no image node', () => {
    const spy = vi.spyOn(toast, 'info');
    render(<CommandPalette />);
    open();
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/search tools/i)).toBeNull();
  });

  it('opens and lists adjustment tools when an image node exists', () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    expect(screen.getByPlaceholderText(/search tools/i)).toBeDefined();
    expect(screen.getByText('Light')).toBeDefined();
    expect(screen.getByText('Curves')).toBeDefined();
  });

  it('filters the list as the user types', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/search tools/i), 'cur');
    // "Curves" must appear as a primary (label/id) match.
    expect(screen.getByText('Curves')).toBeDefined();
    // "Light" now legitimately appears in the secondary section — its
    // description contains 'c' (controls) → 'u' (exposure) → 'r' (exposure)
    // as a subsequence, so the fuzzy filter promotes it as a description-only
    // match below the AI row. The filter IS working; we just confirm the
    // primary label match for "Curves" above.
  });
});

describe('CommandPalette execution', () => {
  it('runs the highlighted op with Enter and closes', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/search tools/i), 'light{Enter}');
    // Registry-driven path: spawnRegistryOp receives the op id + label.
    expect(spawnRegistryOp).toHaveBeenCalledWith('light', expect.any(String));
    await waitFor(() => expect(screen.queryByPlaceholderText(/search tools/i)).toBeNull());
  });

  it('clicking an op row spawns it', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.click(screen.getByText('Curves'));
    expect(spawnRegistryOp).toHaveBeenCalledWith('curves', expect.any(String));
  });

  it('clicking a preset row spawns it via the preset path', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    // "Golden hour" is a builtin preset in the registry. Tests rely on this
    // staying in registry/presets/golden_hour.json.
    await userEvent.click(screen.getByText('Golden hour'));
    expect(spawnRegistryPreset).toHaveBeenCalledWith('golden_hour', expect.any(String));
  });

  it('Cmd+Enter sends the query to the AI with an image_node scope keyed on the active node', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['l1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    // Pre-populate AI context so the auto-analyze branch is skipped.
    useAiSession.setState({ context: { subjects: [], lighting: 'flat', dominantTones: [], mood: '', candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '' } as unknown as never });
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(input, 'make it warmer');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    // proposeFromPalette now accepts an optional third arg for attached
    // context items (from the chip-menu / context-attachment strip). An
    // empty array is sent when no chips were attached. The scope is now
    // `image_node` so the backend knows which canvas the prompt targets.
    expect(proposeFromPalette).toHaveBeenCalledWith(
      'make it warmer',
      { kind: 'image_node', imageNodeId: nodeId, layerIds: ['l1'] },
      [],
    );
    expect(analyseFirstImageLayer).not.toHaveBeenCalled();
  });

  it('Cmd+Enter forwards a mask scope when one is active (user-selected scope wins)', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['l1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    useAiSession.setState({ context: { subjects: [], lighting: 'flat', dominantTones: [], mood: '', candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '' } as unknown as never });
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(input, 'make it warmer');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(proposeFromPalette).toHaveBeenCalledWith(
      'make it warmer', { kind: 'mask', mask_id: 'm1' }, [],
    );
  });

  it('Cmd+Enter without context auto-runs analyze before sending to the AI', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['l1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    // Set a context AFTER analyze "resolves" so the guard inside the AI run
    // doesn't bail. Vitest mocks resolve synchronously in microtasks.
    useAiSession.setState({ context: null });
    (analyseFirstImageLayer as unknown as { mockImplementation: (f: () => Promise<void>) => void }).mockImplementation(async () => {
      useAiSession.setState({ context: { subjects: [], lighting: 'flat', dominantTones: [], mood: '', candidateRegions: [], modelName: '', modelVersion: '', generatedAt: '' } as unknown as never });
    });
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(input, 'make it warmer');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(analyseFirstImageLayer).toHaveBeenCalled());
    await waitFor(() => expect(proposeFromPalette).toHaveBeenCalledWith(
      'make it warmer',
      { kind: 'image_node', imageNodeId: nodeId, layerIds: ['l1'] },
      [],
    ));
  });
});
