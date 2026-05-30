import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WhyPopover } from './WhyPopover';
import { makeAiWidget } from './__fixtures__/widgets';

afterEach(cleanup);

describe('WhyPopover', () => {
  it('renders nothing when closed', () => {
    render(<WhyPopover open={false} widget={makeAiWidget()} onOpenChange={() => {}} />);
    expect(screen.queryByText(/sky reads cool/i)).not.toBeInTheDocument();
  });
  it('renders reasoning + origin kind chip when open', () => {
    render(<WhyPopover open={true} widget={makeAiWidget()} onOpenChange={() => {}} />);
    expect(screen.getByText(/sky reads cool/i)).toBeInTheDocument();
    expect(screen.getByText(/mcp_autonomous/)).toBeInTheDocument();
  });
});
