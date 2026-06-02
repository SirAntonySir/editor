import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CropOverlay } from './CropOverlay';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

afterEach(cleanup);

const baseProps = {
  imageNodeId: 'in-1',
  layerIds: ['l-1'],
  width: 800,
  height: 600,
};

describe('CropOverlay skeleton', () => {
  it('renders the toolbar with aspect chips and Apply/Cancel', () => {
    render(<CropOverlay {...baseProps} />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('1:1')).toBeInTheDocument();
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('Cancel clears cropModalImageNodeId and does NOT call the backend tool', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    await userEvent.click(screen.getByText('Cancel'));
    expect(useEditorStore.getState().cropModalImageNodeId).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('Apply calls set_image_node_transform with the current crop rect and clears modal', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useBackendState.setState({ sessionId: 'sess-1' } as never);
    useEditorStore.setState({ cropModalImageNodeId: 'in-1' } as never);
    render(<CropOverlay {...baseProps} />);
    await userEvent.click(screen.getByText('Apply'));
    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['l-1'],
    }));
    expect(useEditorStore.getState().cropModalImageNodeId).toBeNull();
    spy.mockRestore();
  });
});
