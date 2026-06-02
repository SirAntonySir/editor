import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { WidgetShellHeader } from './WidgetShellHeader';
import { makeAiWidget, makeToolWidget, makeGlobalWidget } from './__fixtures__/widgets';

describe('WidgetShellHeader', () => {
  it('renders AI badge for ai variant', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByLabelText('AI-composed widget')).toBeInTheDocument();
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });

  it('renders muted dot for tool variant', () => {
    render(<WidgetShellHeader widget={makeToolWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByLabelText('Tool-invoked widget')).toBeInTheDocument();
  });

  it('shows the scope chip with region label when anchored', () => {
    render(<WidgetShellHeader widget={makeAiWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByText('sky')).toBeInTheDocument();
  });

  it('shows Global when scope is global', () => {
    render(<WidgetShellHeader widget={makeGlobalWidget()} expanded={false} dirty={false} hidden={false} onToggle={() => {}} onClose={() => {}} onToggleHidden={() => {}} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
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

  it('renders an eye button right of the scope chip and before the chevron', () => {
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
    // Position check: scope chip → eye → chevron.
    const header = btn.closest('[aria-label="Toggle widget"]') as HTMLElement;
    const children = Array.from(header.children) as HTMLElement[];
    const scopeIdx = children.findIndex((c) => c.textContent?.toLowerCase().includes('sky'));
    const eyeIdx = children.indexOf(btn);
    const chevIdx = children.findIndex((c) => c.textContent === '›' || c.textContent === '⌄');
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(eyeIdx).toBeGreaterThan(scopeIdx);
    expect(chevIdx).toBeGreaterThan(eyeIdx);
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
