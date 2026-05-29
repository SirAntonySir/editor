import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PercentBar } from './PercentBar';

describe('PercentBar', () => {
  afterEach(cleanup);

  it('renders an inner fill with the given pct as width', () => {
    const { container } = render(<PercentBar pct={42} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('42%');
  });

  it('clamps negative pct to 0%', () => {
    const { container } = render(<PercentBar pct={-5} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('clamps pct over 100 to 100%', () => {
    const { container } = render(<PercentBar pct={150} color="#0f0" />);
    const fill = container.querySelector('[data-fill]') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('renders the label and a 1-decimal numeric when label is supplied', () => {
    render(<PercentBar pct={42.34} color="#0f0" label="Clipped shadows" />);
    expect(screen.getByText('Clipped shadows')).not.toBeNull();
    expect(screen.getByText('42.3%')).not.toBeNull();
  });
});
