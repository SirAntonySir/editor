import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageNode } from './ImageNode';
import { ReactFlowProvider } from '@xyflow/react';
import { useEditorStore } from '@/store';

afterEach(cleanup);

function renderInFlow(ui: React.ReactNode) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

const baseData = { layerIds: ['l-1'], size: { w: 240, h: 180 } };

describe('ImageNode', () => {
  it('renders header with name and layer-count badge', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky.jpg' }} selected={false} />);
    expect(screen.getByText('Sky.jpg')).toBeInTheDocument();
    expect(screen.getByText('1 LAYER')).toBeInTheDocument();
  });

  it('shows the stack strip ONLY when stacked AND selected', () => {
    const data = { layerIds: ['l-1', 'l-2'], size: baseData.size, name: 'Stacked' };
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={data} selected={false} />);
    expect(screen.queryByLabelText('Layer strip')).not.toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={data} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Layer strip')).toBeInTheDocument();
  });

  it('shows the split/merge affordance ONLY when selected', () => {
    const { rerender } = renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={false} />);
    expect(screen.queryByLabelText('Split or merge')).not.toBeInTheDocument();
    rerender(<ReactFlowProvider><ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected={true} /></ReactFlowProvider>);
    expect(screen.getByLabelText('Split or merge')).toBeInTheDocument();
  });

  it('renders the split affordance outside the overflow-hidden card', () => {
    renderInFlow(<ImageNode id="in-1" data={{ ...baseData, name: 'Sky' }} selected />);
    const btn = screen.getByLabelText('Split or merge');
    // Walk up to find the nearest .overlay ancestor and assert the button is NOT inside it.
    const overlay = btn.closest('.overlay');
    expect(overlay).toBeNull();
  });

  describe('dropdown menu', () => {
    beforeEach(() => {
      useEditorStore.getState().resetWorkspace();
    });

    it('marks the trigger as a menu opener (aria-haspopup="menu")', () => {
      renderInFlow(
        <ImageNode id="in-1" data={{ ...baseData, layerIds: ['l-1', 'l-2'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Split or merge');
      // Radix DropdownMenu.Trigger sets these.
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens the menu when the Split-or-merge trigger is keyboard-activated', async () => {
      const user = userEvent.setup();
      renderInFlow(
        <ImageNode id="in-1" data={{ ...baseData, layerIds: ['l-1', 'l-2'], name: 'Sky' }} selected />,
      );
      const trigger = screen.getByLabelText('Split or merge');
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
      const trigger = screen.getByLabelText('Split or merge');
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
      const trigger = screen.getByLabelText('Split or merge');
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
    expect(style.getPropertyValue('--overlay-shadow')).toContain('rgba(0, 0, 0, 0.1)');
  });
});
