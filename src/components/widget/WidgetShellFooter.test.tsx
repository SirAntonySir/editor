import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { WidgetShellFooter } from './WidgetShellFooter';

afterEach(cleanup);

describe('WidgetShellFooter', () => {
  it('renders the four action buttons', () => {
    render(
      <WidgetShellFooter
        onRefine={() => {}} onWhy={() => {}} onReset={() => {}} onApply={() => {}}
        applyDisabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /refine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /why/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('invokes each callback on click', () => {
    const onRefine = vi.fn(); const onWhy = vi.fn(); const onReset = vi.fn(); const onApply = vi.fn();
    render(<WidgetShellFooter onRefine={onRefine} onWhy={onWhy} onReset={onReset} onApply={onApply} applyDisabled={false} />);
    fireEvent.click(screen.getByRole('button', { name: /refine/i }));
    fireEvent.click(screen.getByRole('button', { name: /why/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(onRefine).toHaveBeenCalledTimes(1);
    expect(onWhy).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('disables Apply when applyDisabled=true', () => {
    render(<WidgetShellFooter onRefine={() => {}} onWhy={() => {}} onReset={() => {}} onApply={() => {}} applyDisabled />);
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled();
  });
});
