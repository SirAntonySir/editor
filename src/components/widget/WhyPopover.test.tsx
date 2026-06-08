import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WhyPopover } from './WhyPopover';
import { makeAiWidget } from './__fixtures__/widgets';
import type { Widget } from '@/types/widget';

afterEach(cleanup);

describe('WhyPopover', () => {
  it('renders nothing when closed', () => {
    render(
      <WhyPopover open={false} widget={makeAiWidget()} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    expect(screen.queryByText(/sky reads cool/i)).not.toBeInTheDocument();
  });
  it('renders reasoning + origin kind chip when open', () => {
    render(
      <WhyPopover open={true} widget={makeAiWidget()} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    expect(screen.getByText(/sky reads cool/i)).toBeInTheDocument();
    expect(screen.getByText(/mcp_autonomous/)).toBeInTheDocument();
  });
});

describe('WhyPopover multi-op widgets', () => {
  it('lists ops by registry display_name when widget has multiple nodes', () => {
    const widget = makeAiWidget({
      display_name: 'Warm fade',
      nodes: [
        { id: 'n_a', type: 'basic',     params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w-1' },
        { id: 'n_b', type: 'splitTone', params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w-1' },
      ] as Widget['nodes'],
    });
    render(
      <WhyPopover open={true} widget={widget} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    // registry display_name for node_type 'basic' maps to color op → 'Color'
    expect(screen.getByText('Color')).toBeInTheDocument();
    // registry display_name for node_type 'splitTone' → 'Split Tone'
    expect(screen.getByText('Split Tone')).toBeInTheDocument();
  });

  it('does not render op breakdown for single-node widgets', () => {
    const widget = makeAiWidget({
      nodes: [
        { id: 'n_a', type: 'grain', params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w-1' },
      ] as Widget['nodes'],
    });
    render(
      <WhyPopover open={true} widget={widget} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    // The multi-op section label should not be present for single-node widgets.
    expect(screen.queryByText('Ops in this widget')).not.toBeInTheDocument();
  });
});
