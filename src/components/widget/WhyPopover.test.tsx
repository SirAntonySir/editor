import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WhyPopover } from './WhyPopover';
import { makeAiWidget } from './__fixtures__/widgets';

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

  it('renders the reasoning text when open', () => {
    render(
      <WhyPopover open={true} widget={makeAiWidget()} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    expect(screen.getByText(/sky reads cool/i)).toBeInTheDocument();
  });

  it('does NOT surface origin chips, prompt chips, or createdAt — only the reasoning paragraph', () => {
    render(
      <WhyPopover open={true} widget={makeAiWidget()} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    expect(screen.queryByText(/mcp_autonomous/)).not.toBeInTheDocument();
    expect(screen.queryByText('Ops in this widget')).not.toBeInTheDocument();
  });

  it('falls back to a placeholder when the widget has no reasoning', () => {
    render(
      <WhyPopover open={true} widget={makeAiWidget({ reasoning: undefined })} onOpenChange={() => {}}>
        <button>why</button>
      </WhyPopover>,
    );
    expect(screen.getByText(/no reasoning available/i)).toBeInTheDocument();
  });
});
