import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandTrigger } from './CommandTrigger';
import { useBackendState } from '@/store/backend-state-slice';
import { usePaletteRuntime } from '@/store/palette-runtime';

beforeEach(() => {
  useBackendState.getState().reset();
  usePaletteRuntime.setState({ pending: null, phase: null, error: null, restore: null });
});
afterEach(() => cleanup());

describe('CommandTrigger', () => {
  it('dispatches spawn-palette:open on click when SSE is open', async () => {
    useBackendState.setState({ sseStatus: 'open' });
    const spy = vi.fn();
    window.addEventListener('spawn-palette:open', spy);
    render(<CommandTrigger />);
    await userEvent.click(screen.getByRole('button', { name: /open command palette/i }));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('spawn-palette:open', spy);
  });

  it('is disabled when SSE is not open', () => {
    useBackendState.setState({ sseStatus: 'connecting' });
    render(<CommandTrigger />);
    expect(screen.getByRole('button', { name: /open command palette/i })).toBeDisabled();
  });

  it('shows a working spinner + the prompt while an Agent turn is pending', () => {
    useBackendState.setState({ sseStatus: 'open' });
    usePaletteRuntime.getState().start('brighten the sky', { doc: [], attachedContext: [] });
    render(<CommandTrigger />);
    expect(screen.getByText(/Working/i)).toBeTruthy();
    expect(screen.getByText('brighten the sky')).toBeTruthy();
  });

  it('shows a retry affordance after a failed turn', () => {
    useBackendState.setState({ sseStatus: 'open' });
    usePaletteRuntime.getState().fail({ message: 'nope' });
    render(<CommandTrigger />);
    expect(screen.getByText(/click to retry/i)).toBeTruthy();
  });
});
