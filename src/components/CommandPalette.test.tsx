import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './CommandPalette';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { LightTool } from '@/tools/light-tool';
import { CurvesTool } from '@/tools/curves-tool';
import { toast } from '@/components/ui/Toast';

vi.mock('@/lib/toolrail-spawn', () => ({ spawnToolWidget: vi.fn(() => true) }));
vi.mock('@/lib/palette-actions', () => ({ proposeFromPalette: vi.fn().mockResolvedValue(undefined) }));

function open() {
  act(() => { window.dispatchEvent(new CustomEvent('spawn-palette:open')); });
}

beforeEach(() => {
  CanvasToolRegistry.register(LightTool);
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
