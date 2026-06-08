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
import { spawnToolWidget } from '@/lib/toolrail-spawn';
import { proposeFromPalette } from '@/lib/palette-actions';

vi.mock('@/lib/toolrail-spawn', () => ({ spawnToolWidget: vi.fn(() => true) }));
vi.mock('@/lib/palette-actions', () => ({ proposeFromPalette: vi.fn().mockResolvedValue({ ok: true }) }));

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
    expect(screen.getByText('Curves')).toBeDefined();
    expect(screen.queryByText('Light')).toBeNull();
  });
});

describe('CommandPalette execution', () => {
  it('runs the highlighted tool with Enter and closes', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.type(screen.getByPlaceholderText(/search tools/i), 'light{Enter}');
    expect(spawnToolWidget).toHaveBeenCalledWith('light');
    await waitFor(() => expect(screen.queryByPlaceholderText(/search tools/i)).toBeNull());
  });

  it('clicking a tool row spawns it', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    await userEvent.click(screen.getByText('Curves'));
    expect(spawnToolWidget).toHaveBeenCalledWith('curves');
  });

  it('Cmd+Enter sends the query to the AI', async () => {
    useEditorStore.getState().addImageNode(['l1']);
    render(<CommandPalette />);
    open();
    const input = screen.getByPlaceholderText(/search tools/i);
    await userEvent.type(input, 'make it warmer');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(proposeFromPalette).toHaveBeenCalledWith('make it warmer', expect.objectContaining({ kind: 'global' }));
  });
});
