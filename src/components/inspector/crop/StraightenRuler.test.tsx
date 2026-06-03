import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { StraightenRuler } from './StraightenRuler';

afterEach(cleanup);

describe('StraightenRuler', () => {
  it('renders the current value with sign', () => {
    render(<StraightenRuler value={2.6} onChange={vi.fn()} />);
    expect(screen.getByText(/\+2\.6°/)).toBeInTheDocument();
  });

  it('renders negative values without forcing a "+" sign', () => {
    render(<StraightenRuler value={-3.2} onChange={vi.fn()} />);
    expect(screen.getByText(/-3\.2°/)).toBeInTheDocument();
  });

  it('clicking the reset button calls onChange(0)', () => {
    const onChange = vi.fn();
    render(<StraightenRuler value={2.6} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reset straighten/i }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('disables reset when value is already 0', () => {
    render(<StraightenRuler value={0} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /reset straighten/i })).toBeDisabled();
  });

  it('exposes the slider role with aria-valuenow', () => {
    render(<StraightenRuler value={2.6} onChange={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: /straighten/i });
    expect(slider).toHaveAttribute('aria-valuenow', '2.6');
    expect(slider).toHaveAttribute('aria-valuemin', '-45');
    expect(slider).toHaveAttribute('aria-valuemax', '45');
  });
});
