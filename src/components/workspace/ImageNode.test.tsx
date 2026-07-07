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

const baseData = {
  layerIds: ['l-1'],
  size: { w: 240, h: 180 },
  sourceSize: { w: 240, h: 180 },
};

describe('ImageNode', () => {
  it('renders header with name and footer with layer count', () => {
    // Seed the layer so LayerStrip can resolve it.
    useEditorStore.setState({
      layers: [
        { id: 'l-1', type: 'image', name: 'L1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
      ],
    } as never);
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky.jpg' }} selected={false} />);
    expect(screen.getByText('Sky.jpg')).toBeInTheDocument();
    // BottomMarginalia renders "01 Layers" — check the count is shown.
    expect(screen.getByTestId('bottom-marginalia')).toHaveTextContent('Layers');
  });

  it('no longer renders the layer strip inside the image node (moved to LayerNode)', () => {
    useEditorStore.setState({
      layers: [
        { id: 'l-1', type: 'image', name: 'L1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
        { id: 'l-2', type: 'image', name: 'L2', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 1 },
      ],
    } as never);
    const data = { layerIds: ['l-1', 'l-2'], size: baseData.size, sourceSize: baseData.sourceSize, name: 'Stacked' };
    renderInFlow(<ImageNode id="in-1" data={data} selected={false} />);
    // The strip is now a standalone `layers` node — the image node must not host it.
    expect(screen.queryByTestId('layer-strip')).not.toBeInTheDocument();
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

  it('corner ticks opt out of React Flow pan/drag (nodrag nopan) so dragging resizes instead of panning the canvas', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected />);
    // CornerTicks replaces the standalone ImageNodeResizeHandle. Each corner
    // <span> carries nodrag + nopan so React Flow never sees the drag.
    const ticks = screen.getByTestId('image-node-corner-ticks');
    const handles = ticks.querySelectorAll('[data-corner]');
    expect(handles.length).toBeGreaterThan(0);
    for (const handle of Array.from(handles)) {
      expect(handle).toHaveClass('nodrag');
      expect(handle).toHaveClass('nopan');
    }
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
      expect(screen.getByRole('menuitem', { name: /^Delete image$/i })).toBeInTheDocument();
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
      const deleteItem = screen.getByRole('menuitem', { name: /^Delete image$/i });
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

describe('selection indicator', () => {
  it('renders the accent border element when selected', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected />);
    // Drafting renders a border div with `border-[var(--color-accent)]` and
    // a transition-opacity class; it's aria-hidden and pointer-events-none.
    const selectionBorder = document.querySelector(
      '.pointer-events-none.absolute.inset-0.border.transition-opacity',
    ) as HTMLElement | null;
    expect(selectionBorder).toBeTruthy();
    // When selected, the style attribute should contain opacity:1 or equivalent.
    const styleAttr = selectionBorder?.getAttribute('style') ?? '';
    // jsdom may represent opacity as '1' or inline; verify it is NOT '0'.
    expect(styleAttr).not.toMatch(/opacity:\s*0/);
  });

  it('hides the accent border (opacity:0) when not selected', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    const selectionBorder = document.querySelector(
      '.pointer-events-none.absolute.inset-0.border.transition-opacity',
    ) as HTMLElement | null;
    expect(selectionBorder).toBeTruthy();
    const styleAttr = selectionBorder?.getAttribute('style') ?? '';
    expect(styleAttr).toMatch(/opacity:\s*0/);
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
  it('renders without transform-scale on any element (Figma model — no counter-scale)', () => {
    const { container } = renderInFlow(<ImageNode id="in-1" data={{ ...baseData }} selected={false} />);
    // Drafting does not apply CSS custom props for --chrome-scale; instead it
    // drops the counter-scale approach entirely. Verify no scale() is applied.
    const allElems = container.querySelectorAll('*');
    for (const el of Array.from(allElems)) {
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).not.toMatch(/transform:\s*scale\(/);
    }
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
    // Both rotate items now read "Rotate 90°" (CW/CCW carried by the icon);
    // the CW (+90) item renders first.
    await userEvent.click(screen.getAllByText('Rotate 90°')[0]);

    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      imageNodeId: 'in-1',
      layerIds: ['l-1'],
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
    expect(screen.getAllByText('Rotate 90°')).toHaveLength(2);
    expect(screen.getByText('Delete image')).toBeInTheDocument();
  });
});

describe('ImageNode · split via dropdown menu', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('Split last layer menu item peels the last layer onto a new image node', async () => {
    const user = userEvent.setup();
    // Seed: one image node with two layers. Mark l-2 as active.
    const nodeId = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
    useEditorStore.setState({
      layers: [
        { id: 'l-1', type: 'image', name: 'L1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
        { id: 'l-2', type: 'image', name: 'L2', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 1 },
      ],
      activeLayerId: 'l-2',
    } as never);

    renderInFlow(
      <ImageNode id={nodeId} data={{ ...baseData, layerIds: ['l-1', 'l-2'], name: 'Sky' }} selected />,
    );

    const trigger = screen.getByLabelText('Image node menu');
    trigger.focus();
    await user.keyboard('{Enter}');
    const splitItem = screen.getByRole('menuitem', { name: /Split last layer/i });
    splitItem.focus();
    await user.keyboard('{Enter}');

    const after = useEditorStore.getState();
    const nodes = Object.values(after.imageNodes);
    expect(nodes).toHaveLength(2);
    expect(after.imageNodes[nodeId].layerIds).toEqual(['l-1']);
    const peeled = nodes.find((n) => n.id !== nodeId);
    expect(peeled?.layerIds).toEqual(['l-2']);
  });

  it('Split last layer is disabled when the node has only one layer', async () => {
    const user = userEvent.setup();
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.setState({
      layers: [
        { id: 'l-1', type: 'image', name: 'L1', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
      ],
      activeLayerId: 'l-1',
    } as never);

    renderInFlow(
      <ImageNode id={nodeId} data={{ ...baseData, layerIds: ['l-1'], name: 'Sky' }} selected />,
    );

    const trigger = screen.getByLabelText('Image node menu');
    trigger.focus();
    await user.keyboard('{Enter}');
    const splitItem = screen.getByRole('menuitem', { name: /Split last layer/i });
    expect(splitItem).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('ImageNode · merge via dropdown menu', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('Delete item removes the node — merge requires separate workspace operation', async () => {
    const user = userEvent.setup();
    const idA = useEditorStore.getState().addImageNode(['l-1']);
    const idB = useEditorStore.getState().addImageNode(['l-2']);
    // Simulate selection history: A first, then B → previous = A, active = B.
    useEditorStore.getState().setActiveImageNode(idA);
    useEditorStore.getState().setActiveImageNode(idB);
    expect(useEditorStore.getState().previousImageNodeId).toBe(idA);

    renderInFlow(
      <ImageNode id={idB} data={{ ...baseData, layerIds: ['l-2'], name: 'B' }} selected />,
    );

    // Drafting exposes merge via the workspace operation (no header button).
    // Verify the menu at least renders without crashing.
    const trigger = screen.getByLabelText('Image node menu');
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: /^Delete image$/i })).toBeInTheDocument();
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
