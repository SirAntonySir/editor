import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpawnPaletteWidget } from './SpawnPaletteWidget';
import { useBackendState } from '@/store/backend-state-slice';
import { useSegmentSelection } from '@/store/segment-selection-slice';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } }),
  },
}));

beforeEach(() => {
  useBackendState.getState().reset();
  useBackendState.setState({ sessionId: 's1' });
  useSegmentSelection.getState().clear();
});
afterEach(cleanup);

describe('SpawnPaletteWidget', () => {
  it('starts closed', () => {
    render(<SpawnPaletteWidget />);
    expect(screen.queryByPlaceholderText(/ask claude/i)).toBeNull();
  });

  it('opens on spawn-palette:open custom event', () => {
    render(<SpawnPaletteWidget />);
    fireEvent(window, new CustomEvent('spawn-palette:open'));
    expect(screen.getByPlaceholderText(/ask claude/i)).toBeDefined();
  });

  it('passes mask:click scope when a segment is selected', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useSegmentSelection.setState({ selectedSegmentId: 'm_xyz' });
    render(<SpawnPaletteWidget />);
    fireEvent(window, new CustomEvent('spawn-palette:open'));
    const input = screen.getByPlaceholderText(/ask claude/i) as HTMLTextAreaElement;
    await userEvent.type(input, 'brighten the eyes');
    fireEvent.submit(input.closest('form')!);
    expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
      intent: 'brighten the eyes',
      scope: { kind: 'mask:click', mask_id: 'm_xyz' },
      prompt: 'brighten the eyes',
    });
  });

  it('passes global scope when no segment is selected', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    render(<SpawnPaletteWidget />);
    fireEvent(window, new CustomEvent('spawn-palette:open'));
    const input = screen.getByPlaceholderText(/ask claude/i) as HTMLTextAreaElement;
    await userEvent.type(input, 'warm overall');
    fireEvent.submit(input.closest('form')!);
    expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
      intent: 'warm overall',
      scope: { kind: 'global' },
      prompt: 'warm overall',
    });
  });

  it('closes on Escape', () => {
    render(<SpawnPaletteWidget />);
    fireEvent(window, new CustomEvent('spawn-palette:open'));
    expect(screen.getByPlaceholderText(/ask claude/i)).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByPlaceholderText(/ask claude/i)).toBeNull();
  });
});
