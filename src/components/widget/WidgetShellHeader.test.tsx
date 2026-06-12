import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { WidgetShellHeader } from './WidgetShellHeader';
import { makeAiWidget, makeToolWidget, makeGlobalWidget } from './__fixtures__/widgets';

const baseProps = {
  expanded: false,
  dirty: false,
  hidden: false,
  onToggle: () => {},
  onClose: () => {},
  onToggleHidden: () => {},
  onRefine: () => {},
  onWhy: () => {},
  onReset: () => {},
  onApply: () => {},
  applyDisabled: false,
  showAiAffordances: true,
};

describe('WidgetShellHeader', () => {
  it('renders AI badge for ai variant', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} />);
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });

  it('omits any tool-invoked badge for tool variant (header stays minimal)', () => {
    render(<WidgetShellHeader widget={makeToolWidget()} {...baseProps} showAiAffordances={false} />);
    expect(screen.queryByLabelText('Tool-invoked widget')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('AI-composed widget')).not.toBeInTheDocument();
  });

  it('shows the scope chip with region label when anchored', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} />);
    expect(screen.getByText('sky')).toBeInTheDocument();
  });

  it('hides the scope chip when scope is global (default scope adds no info)', () => {
    render(<WidgetShellHeader widget={makeGlobalWidget()} {...baseProps} />);
    expect(screen.queryByText(/global/i)).not.toBeInTheDocument();
  });

  it('never renders the legacy "Bindings edited" dot, regardless of dirty', () => {
    const { rerender } = render(
      <WidgetShellHeader widget={makeAiWidget()} {...baseProps} />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(
      <WidgetShellHeader widget={makeAiWidget()} {...baseProps} dirty />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
  });

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn();
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle widget/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders close button only when expanded; clicking it invokes onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /close widget/i })).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} expanded onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close widget/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an eye button right of the scope chip', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} />);
    const btn = screen.getByRole('button', { name: /hide widget/i });
    expect(btn).toBeInTheDocument();
    // Position check: scope chip → eye. The chevron is gone — the body's
    // visibility now is the expand cue.
    const header = btn.closest('[aria-label="Toggle widget"]') as HTMLElement;
    const children = Array.from(header.children) as HTMLElement[];
    const scopeIdx = children.findIndex((c) => c.textContent?.toLowerCase().includes('sky'));
    const eyeIdx = children.indexOf(btn);
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(eyeIdx).toBeGreaterThan(scopeIdx);
    // Chevron must not appear anywhere.
    expect(children.some((c) => c.textContent === '›' || c.textContent === '⌄')).toBe(false);
  });

  it('eye button aria-label flips between Hide and Show based on hidden prop', () => {
    const { rerender } = render(
      <WidgetShellHeader widget={makeAiWidget()} {...baseProps} />,
    );
    expect(screen.getByRole('button', { name: /hide widget/i })).toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} hidden />);
    expect(screen.getByRole('button', { name: /show widget/i })).toBeInTheDocument();
  });

  it('clicking the eye fires onToggleHidden and does not fire onToggle', () => {
    const onToggle = vi.fn();
    const onToggleHidden = vi.fn();
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        {...baseProps}
        onToggle={onToggle}
        onToggleHidden={onToggleHidden}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('WidgetShellHeader action buttons', () => {
  it('hides action buttons (Refine, Why, Reset, Apply) when collapsed', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} expanded={false} />);
    expect(screen.queryByRole('button', { name: /refine widget/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /explain widget/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset widget/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply widget/i })).not.toBeInTheDocument();
  });

  it('shows all four AI action buttons when expanded on an AI widget', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} expanded />);
    expect(screen.getByRole('button', { name: /refine widget/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /explain widget/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset widget/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply widget/i })).toBeInTheDocument();
  });

  it('omits Refine and Why? when showAiAffordances is false (tool-invoked)', () => {
    render(
      <WidgetShellHeader
        widget={makeToolWidget()}
        {...baseProps}
        expanded
        showAiAffordances={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /refine widget/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /explain widget/i })).not.toBeInTheDocument();
    // Reset + Apply still render — they apply to tool widgets too.
    expect(screen.getByRole('button', { name: /reset widget/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply widget/i })).toBeInTheDocument();
  });

  it('routes each action button click to its callback and stops propagation', () => {
    const callbacks = {
      onToggle: vi.fn(),
      onRefine: vi.fn(),
      onWhy: vi.fn(),
      onReset: vi.fn(),
      onApply: vi.fn(),
    };
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        {...baseProps}
        expanded
        {...callbacks}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /refine widget/i }));
    fireEvent.click(screen.getByRole('button', { name: /explain widget/i }));
    fireEvent.click(screen.getByRole('button', { name: /reset widget/i }));
    fireEvent.click(screen.getByRole('button', { name: /apply widget/i }));
    expect(callbacks.onRefine).toHaveBeenCalledTimes(1);
    expect(callbacks.onWhy).toHaveBeenCalledTimes(1);
    expect(callbacks.onReset).toHaveBeenCalledTimes(1);
    expect(callbacks.onApply).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggle).not.toHaveBeenCalled();
  });

  it('disables the Apply button when applyDisabled is true', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} {...baseProps} expanded applyDisabled />);
    expect(screen.getByRole('button', { name: /apply widget/i })).toBeDisabled();
  });
});

describe('WidgetShellHeader title resolution', () => {
  it('uses display_name when present', () => {
    render(
      <WidgetShellHeader widget={makeAiWidget({ displayName: 'Warm shift' })} {...baseProps} />,
    );
    expect(screen.getByText('Warm shift')).toBeInTheDocument();
  });

  it('falls back to registry op display_name when display_name is null and single-op', () => {
    render(
      <WidgetShellHeader widget={makeToolWidget({ displayName: null, opId: 'kelvin' })} {...baseProps} />,
    );
    expect(screen.getByText('White Balance')).toBeInTheDocument();
  });

  it('falls back to intent for unknown opId (no registry match)', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget({ displayName: null, opId: 'unknown_op', intent: 'make it warmer' })}
        {...baseProps}
      />,
    );
    expect(screen.getByText('make it warmer')).toBeInTheDocument();
  });
});
