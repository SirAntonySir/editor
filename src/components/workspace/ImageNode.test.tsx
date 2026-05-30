import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ImageNode } from './ImageNode';
import { ReactFlowProvider } from '@xyflow/react';

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
});
