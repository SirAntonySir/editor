import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageNode } from './ImageNode';
import { ReactFlowProvider } from '@xyflow/react';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { usePreferencesStore } from '@/store/preferences-store';

const { useImageNodeRenderMock } = vi.hoisted(() => ({
  useImageNodeRenderMock: vi.fn<(args: { bypassAdjustments?: boolean }) => { canvasRef: { current: HTMLCanvasElement | null } }>(),
}));
useImageNodeRenderMock.mockImplementation(() => ({ canvasRef: { current: null } }));
vi.mock('@/hooks/useImageNodeRender', () => ({
  useImageNodeRender: useImageNodeRenderMock,
}));

afterEach(cleanup);

function renderInFlow(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

const baseData = { layerIds: ['l-1'], size: { w: 240, h: 180 } };

describe('ImageNode', () => {
  it('renders header with name and footer with layer counter', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky.jpg' }} selected={false} />);
    expect(screen.getByText('Sky.jpg')).toBeInTheDocument();
    expect(screen.getByText('Layer 1/1')).toBeInTheDocument();
  });

  it('shows the stack strip ONLY when stacked AND selected', () => {
    const data = { layerIds: ['l-1', 'l-2'], size: baseData.size, name: 'Stacked' };
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={data} selected={false} />);
    expect(screen.queryByLabelText('Layer strip')).not.toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={data} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Layer strip')).toBeInTheDocument();
  });

  it('shows the image node menu button regardless of selection state', () => {
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={false} />);
    // The 3-dot button is always visible (not gated on selected).
    expect(screen.getByLabelText('Image node menu')).toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Image node menu')).toBeInTheDocument();
  });

  it('renders the 3-dot menu button inside the workspace-drag-handle element', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected />);
    const btn = screen.getByLabelText('Image node menu');
    const handle = btn.closest('.workspace-drag-handle');
    expect(handle).not.toBeNull();
  });

  describe('dropdown menu', () => {
    beforeEach(() => {
      useEditorStore.getState().resetWorkspace();
    });

    it('marks the trigger as a menu opener (aria-haspopup="menu")', () => {
      renderInFlow(
        <ImageNode id="in-1" data={{ ...baseData, layerIds: ['l-1', 'l-2'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Image node menu');
      // Radix DropdownMenu.Trigger sets these.
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the menu when the Image-node-menu trigger is keyboard-activated', async () => {
      const user = userEvent.setup();
      renderInFlow(
        <ImageNode id="in-1" data={{ ...baseData, layerIds: ['l-1', 'l-2'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Image node menu');
      // Radix DropdownMenu's Trigger reliably opens via keyboard activation under jsdom.
      trigger.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('menuitem', { name: /Split last layer/i })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /^Delete$/i })).toBeInTheDocument();
    });

    it('Delete menu item removes the node from the store', async () => {
      const user = userEvent.setup();
      const id = useEditorStore.getState().addImageNode(['l-1']);
      expect(useEditorStore.getState().imageNodes[id]).toBeDefined();
      renderInFlow(
        <ImageNode id={id} data={{ ...baseData, layerIds: ['l-1'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Image node menu');
      trigger.focus();
      await user.keyboard('{Enter}');
      const deleteItem = screen.getByRole('menuitem', { name: /^Delete$/i });
      deleteItem.focus();
      await user.keyboard('{Enter}');
      expect(useEditorStore.getState().imageNodes[id]).toBeUndefined();
    });

    it('Split last layer menu item peels the last layer onto a new node', async () => {
      const user = userEvent.setup();
      const id = useEditorStore.getState().addImageNode(['L1', 'L2', 'L3']);
      renderInFlow(
        <ImageNode id={id} data={{ ...baseData, layerIds: ['L1', 'L2', 'L3'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Image node menu');
      trigger.focus();
      await user.keyboard('{Enter}');
      const splitItem = screen.getByRole('menuitem', { name: /Split last layer/i });
      splitItem.focus();
      await user.keyboard('{Enter}');
      const after = useEditorStore.getState();
      expect(after.imageNodes[id].layerIds).toEqual(['L1', 'L2']);
      // A new node with the peeled layer should exist.
      const peeled = Object.values(after.imageNodes).find((n) => n.id !== id);
      expect(peeled?.layerIds).toEqual(['L3']);
    });
  });
});

describe('selection glow', () => {
  it('applies .workspace-node-selected when selected and removes the old outline class', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(true);
    expect(overlay.classList.contains('outline-2')).toBe(false);
  });

  it('omits .workspace-node-selected when not selected', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay.classList.contains('workspace-node-selected')).toBe(false);
  });
});

describe('tether handles', () => {
  it('mounts target handles on all four sides', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    expect(document.querySelector('[data-handleid="tether-in-left"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-right"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-top"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-in-bottom"]')).toBeTruthy();
  });
});

describe('zoom-invariant chrome', () => {
  it('writes --chrome-scale, --overlay-border-width, --overlay-radius, --overlay-shadow on the .overlay root', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    // useChromeScale defaults to 1 at workspace zoom >= 1 (the test env's default).
    const style = overlay.style;
    expect(style.getPropertyValue('--chrome-scale')).toBe('1');
    expect(style.getPropertyValue('--overlay-border-width')).toBe('1px');
    expect(style.getPropertyValue('--overlay-radius')).toBe('8px');
    expect(style.getPropertyValue('--overlay-shadow')).toContain('var(--shadow-overlay-color)');
  });
});

describe('header dropdown transform items', () => {
  it('Rotate 90° CW calls set_image_node_transform with angle +90 delta', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    useBackendState.setState({ sessionId: 'sess-1' } as never);

    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    await userEvent.click(screen.getByLabelText('Image node menu'));
    await userEvent.click(screen.getByText('Rotate 90° CW'));

    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['l-1'],
      rotate: expect.objectContaining({ angle: 90 }),
    }));
    spy.mockRestore();
  });
});

describe('Crop… menu item', () => {
  it('routes Crop… through showCrop() — opens sidebar and selects crop tab', async () => {
    usePreferencesStore.setState({ inspectorTab: 'adjustments', rightSidebarCollapsed: true });
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    await userEvent.click(screen.getByLabelText('Image node menu'));
    await userEvent.click(screen.getByText('Crop…'));
    expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
    expect(usePreferencesStore.getState().rightSidebarCollapsed).toBe(false);
  });
});

describe('ImageNode chrome scaling (Figma model)', () => {
  it('does not apply transform-scale to any chrome element', () => {
    const { container } = renderInFlow(
      <ImageNode id="in-1" data={{ ...baseData, name: 'Sky.jpg' }} selected={false} />,
    );
    const allElems = container.querySelectorAll('*');
    for (const el of Array.from(allElems)) {
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).not.toMatch(/transform:\s*scale\(/);
    }
  });
});

describe('right-click context menu', () => {
  it('right-clicking the image body opens the context menu with the same items', async () => {
    const user = userEvent.setup();
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    const body = screen.getByLabelText('Image node body');
    await user.pointer({ target: body, keys: '[MouseRight]' });
    expect(await screen.findByText('Crop…')).toBeInTheDocument();
    expect(screen.getByText('Rotate 90° CW')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});

describe('ImageNode · compare button', () => {
  beforeEach(() => {
    useImageNodeRenderMock.mockClear();
  });

  function lastBypass(): boolean | undefined {
    const calls = useImageNodeRenderMock.mock.calls;
    if (calls.length === 0) return undefined;
    return calls[calls.length - 1][0].bypassAdjustments;
  }

  it('renders the compare button inline in the header strip regardless of selection', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    expect(screen.getByRole('button', { name: /show original/i })).toBeInTheDocument();
  });

  it('pointerdown on the compare button flips bypassAdjustments to true; pointerup clears it', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    expect(lastBypass()).toBe(false);
    const btn = screen.getByRole('button', { name: /show original/i });
    fireEvent.pointerDown(btn);
    expect(lastBypass()).toBe(true);
    fireEvent.pointerUp(btn);
    expect(lastBypass()).toBe(false);
  });

  it('pointerleave on the button also clears bypassAdjustments', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    const btn = screen.getByRole('button', { name: /show original/i });
    fireEvent.pointerDown(btn);
    expect(lastBypass()).toBe(true);
    fireEvent.pointerLeave(btn);
    expect(lastBypass()).toBe(false);
  });

  it('compare button stops pointerdown propagation (does not bubble to drag-handle strip)', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    const btn = screen.getByRole('button', { name: /show original/i });
    const handle = btn.closest('.workspace-drag-handle') as HTMLElement;
    const handleSpy = vi.fn();
    handle.addEventListener('pointerdown', handleSpy);
    fireEvent.pointerDown(btn);
    expect(handleSpy).not.toHaveBeenCalled();
  });
});
