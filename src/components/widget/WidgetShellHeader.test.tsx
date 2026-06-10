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
};

describe('WidgetShellHeader', () => {
  it('renders AI badge for ai variant', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });

  it('omits any tool-invoked badge for tool variant (header stays minimal)', () => {
    render(<WidgetShellHeader widget={makeToolWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.queryByLabelText('Tool-invoked widget')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('AI-composed widget')).not.toBeInTheDocument();
  });

  it('shows the scope chip with region label when anchored', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByText('sky')).toBeInTheDocument();
  });

  it('hides the scope chip when scope is global (default scope adds no info)', () => {
    render(<WidgetShellHeader widget={makeGlobalWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.queryByText(/global/i)).not.toBeInTheDocument();
  });

  it('never renders the legacy "Bindings edited" dot, regardless of dirty', () => {
    const { rerender } = render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
    rerender(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={true}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Bindings edited')).not.toBeInTheDocument();
  });

  it('clicking the header invokes onToggle', () => {
    const onToggle = vi.fn();
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={onToggle} onClose={() => {}} onToggleHidden={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders close button only when expanded; clicking it invokes onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={onClose} onToggleHidden={() => {}} />);
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    rerender(<WidgetShellHeader widget={makeAiWidget()} expanded={true} dirty={false} hidden={false} onToggle={() => {}} onClose={onClose} onToggleHidden={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an eye button right of the scope chip', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
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
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /hide widget/i })).toBeInTheDocument();
    rerender(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={true}
        onToggle={() => {}}
        onClose={() => {}}
        onToggleHidden={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /show widget/i })).toBeInTheDocument();
  });

  it('clicking the eye fires onToggleHidden and does not fire onToggle', () => {
    const onToggle = vi.fn();
    const onToggleHidden = vi.fn();
    render(
      <WidgetShellHeader
        widget={makeAiWidget()}
        expanded={false}
        dirty={false}
        hidden={false}
        onToggle={onToggle}
        onClose={() => {}}
        onToggleHidden={onToggleHidden}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /hide widget/i }));
    expect(onToggleHidden).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('WidgetShellHeader title resolution', () => {
  it('uses display_name when present', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget({ display_name: 'Warm shift' })}
        {...baseProps}
      />,
    );
    expect(screen.getByText('Warm shift')).toBeInTheDocument();
  });

  it('falls back to registry op display_name when display_name is null and single-op', () => {
    render(
      <WidgetShellHeader
        widget={makeToolWidget({ display_name: null, op_id: 'kelvin' })}
        {...baseProps}
      />,
    );
    expect(screen.getByText('White Balance')).toBeInTheDocument();
  });

  it('falls back to intent for unknown op_id (no registry match)', () => {
    render(
      <WidgetShellHeader
        widget={makeAiWidget({ display_name: null, op_id: 'unknown_op', intent: 'make it warmer' })}
        {...baseProps}
      />,
    );
    expect(screen.getByText('make it warmer')).toBeInTheDocument();
  });
});
