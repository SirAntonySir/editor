import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CircularDial } from './CircularDial';
import type { Anchor } from '@/lib/perceptual-dial/types';

function seasonAnchors(): Anchor[] {
  return [
    { id: 'spring', label: 'Spring', position: [0.00],
      params: { 'kelvin.kelvin': 7000 } },
    { id: 'summer', label: 'Summer', position: [0.33],
      params: { 'kelvin.kelvin': 7500 } },
    { id: 'autumn', label: 'Autumn', position: [0.66],
      params: { 'kelvin.kelvin': 8500 } },
    { id: 'winter', label: 'Winter', position: [1.00],
      params: { 'kelvin.kelvin': 5500 } },
  ];
}

describe('CircularDial', () => {
  it('renders N pie wedges for N anchors', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    const wedges = container.querySelectorAll('[data-testid="wedge"]');
    expect(wedges.length).toBe(4);
  });

  it('renders an indicator dot', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="indicator"]')).not.toBeNull();
  });

  it('renders anchor label inside each wedge', () => {
    const { getByText } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}
        onPositionChange={vi.fn()}
      />,
    );
    expect(getByText(/Spring/i)).toBeTruthy();
    expect(getByText(/Summer/i)).toBeTruthy();
    expect(getByText(/Autumn/i)).toBeTruthy();
    expect(getByText(/Winter/i)).toBeTruthy();
  });

  it('calls onPositionChange with anchor position when wedge is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.00}
        onPositionChange={onChange}
      />,
    );
    const wedges = container.querySelectorAll('[data-testid="wedge"]');
    // Click the autumn wedge (3rd one, index 2)
    fireEvent.click(wedges[2]);
    expect(onChange).toHaveBeenCalledWith(0.66);
  });

  it('marks the active wedge based on nearest anchor to position', () => {
    const { container, rerender } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.66}    // autumn
        onPositionChange={vi.fn()}
      />,
    );
    const activeAutumn = container.querySelector('[data-testid="wedge"][data-active="true"]');
    expect(activeAutumn?.getAttribute('data-anchor-id')).toBe('autumn');

    rerender(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.00}    // spring
        onPositionChange={vi.fn()}
      />,
    );
    const activeSpring = container.querySelector('[data-testid="wedge"][data-active="true"]');
    expect(activeSpring?.getAttribute('data-anchor-id')).toBe('spring');
  });

  it('positions the indicator on the right side for summer (position 0.33)', () => {
    const { container } = render(
      <CircularDial
        anchors={seasonAnchors()}
        position={0.33}    // summer → 90° (right)
        onPositionChange={vi.fn()}
      />,
    );
    const indicator = container.querySelector('[data-testid="indicator"]') as SVGCircleElement | null;
    expect(indicator).not.toBeNull();
    // Right side of wheel: x > center, y ≈ center
    const cx = Number(indicator?.getAttribute('cx'));
    const cy = Number(indicator?.getAttribute('cy'));
    expect(cx).toBeGreaterThan(160);    // right of center (viewBox 0..320)
    expect(Math.abs(cy - 160)).toBeLessThan(5);    // close to center vertically
  });
});
