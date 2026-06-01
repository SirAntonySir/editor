import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ColourBandToolRow } from './ColourBandToolRow';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { propose_widget: vi.fn().mockResolvedValue({ ok: true }) } }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('opens a swatch popover and spawns a single-band widget for the picked colour', () => {
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open' } as never);
  useEditorStore.setState({ activeLayerId: 'L1' } as never);
  render(<ColourBandToolRow />);
  // popover closed initially
  expect(screen.queryByLabelText('Blue')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /colour band/i }));
  fireEvent.click(screen.getByLabelText('Blue'));
  expect(backendTools.propose_widget).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({ fused_tool_id: 'hsl_blue', origin: 'tool_invoked', layer_id: 'L1' }),
  );
});

it('is disabled when offline', () => {
  useBackendState.setState({ sessionId: 's1', sseStatus: 'connecting' } as never);
  useEditorStore.setState({ activeLayerId: 'L1' } as never);
  render(<ColourBandToolRow />);
  expect(screen.getByRole('button', { name: /colour band/i })).toBeDisabled();
});
