import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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

describe('CropOverlay corner handles', () => {
  it('renders four corner handles', () => {
    render(<CropOverlay {...baseProps} />);
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(4);
  });

  it('dragging the bottom-right handle resizes the crop rect', () => {
    render(<CropOverlay {...baseProps} />);
    const handle = document.querySelector('[data-handle="br"]') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 800, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const mask = document.querySelector('[data-testid="crop-mask"]') as HTMLElement;
    expect(mask.style.getPropertyValue('--crop-w')).toBe('700');
    expect(mask.style.getPropertyValue('--crop-h')).toBe('500');
  });
});
