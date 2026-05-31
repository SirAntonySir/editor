import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandTrigger } from './CommandTrigger';
import { useBackendState } from '@/store/backend-state-slice';

beforeEach(() => useBackendState.getState().reset());
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
});
