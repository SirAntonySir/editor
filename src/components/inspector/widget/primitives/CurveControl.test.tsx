import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CurveControl } from './CurveControl';
import { IDENTITY_CURVES } from '@/types/widget';

describe('CurveControl', () => {
  it('renders an svg curve editor', () => {
    const { container } = render(
      <CurveControl label="Curves" value={IDENTITY_CURVES} onChange={() => {}} />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('emits an updated CurvesValue when a point is added on the svg', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CurveControl label="Curves" value={IDENTITY_CURVES} onChange={onChange} />,
    );
    const svg = container.querySelector('svg')!;
    // jsdom has no layout; stub the bounding rect so the editor's coord mapping works
    svg.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        right: 100,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    // Click at (50,50) → normalized (0.5, 0.5). Identity points are at (0,0) and (1,1),
    // so this is well outside hit-radius (0.04) and adds a new point → rgb.length goes 2→3.
    fireEvent.mouseDown(svg, { clientX: 50, clientY: 50 });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.rgb.length).toBeGreaterThan(2); // a point was added to the rgb channel
  });
});
