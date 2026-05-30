import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { WidgetShellHeader } from './WidgetShellHeader';
import { makeAiWidget, makeToolWidget, makeGlobalWidget } from './__fixtures__/widgets';

describe('WidgetShellHeader', () => {
  it('renders AI badge for ai variant', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });

  it('renders muted dot for tool variant', () => {
    render(<WidgetShellHeader widget={makeToolWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Tool-invoked widget')).toBeInTheDocument();
  });

  it('shows the scope chip with region label when anchored', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByText('sky')).toBeInTheDocument();
  });

  it('shows Global when scope is global', () => {
    render(<WidgetShellHeader widget={makeGlobalWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows the dirty dot only when dirty=true', () => {
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={true} onToggle={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText('Bindings edited')).toBeInTheDocument();
  });

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn();
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={onToggle} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders close button only when expanded; clicking it invokes onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} onToggle={() => {}} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={true} dirty={false} onToggle={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
