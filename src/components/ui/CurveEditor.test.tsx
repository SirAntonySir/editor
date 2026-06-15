import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CurveEditor } from './CurveEditor';
import type { CurvesValue } from '@/types/widget';

afterEach(cleanup);

function makeValue(rgb: { x: number; y: number }[]): CurvesValue {
  return {
    rgb,
    red:   [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    blue:  [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  };
}

function stubSvg(svg: SVGSVGElement, rect: { left: number; top: number; width: number; height: number }) {
  svg.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  // jsdom doesn't implement pointer-capture; stub the methods so the
  // component can call them safely.
  (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = vi.fn();
  (svg as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = vi.fn();
}

describe('CurveEditor — defensive value handling', () => {
  it('renders without crashing when value is the number 0', () => {
    // Reproduces the legacy fused-template bug (bw_cinematic / teal_orange /
    // sky_recovery) where the binding value collapses to the envelope
    // midpoint (0) because their LLM resolver schema omits the `points` key.
    expect(() =>
      render(<CurveEditor value={0 as unknown as CurvesValue} onChange={() => {}} />),
    ).not.toThrow();
  });

  it('renders without crashing when value is null', () => {
    expect(() =>
      render(<CurveEditor value={null as unknown as CurvesValue} onChange={() => {}} />),
    ).not.toThrow();
  });

  it('renders without crashing when value is partial (only one channel)', () => {
    const partial = { red: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as CurvesValue;
    expect(() =>
      render(<CurveEditor value={partial} onChange={() => {}} />),
    ).not.toThrow();
  });
});

describe('CurveEditor — pointer drag', () => {
  it('moves the dragged point under the pointer', () => {
    const onChange = vi.fn();
    const value = makeValue([
      { x: 0,   y: 0   },
      { x: 0.5, y: 0.5 },
      { x: 1,   y: 1   },
    ]);
    const { container } = render(
      <CurveEditor value={value} onChange={onChange} channel="rgb" />,
    );
    const svg = container.querySelector('svg')!;
    stubSvg(svg, { left: 0, top: 0, width: 200, height: 200 });

    // pointerdown at (100,100) → svgToPoint = (0.5, 0.5) which matches
    // the middle point.
    svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    // Drag to (120, 80) → (0.6, 0.6).
    svg.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 80, bubbles: true }));
    svg.dispatchEvent(new PointerEvent('pointerup',   { clientX: 120, clientY: 80, bubbles: true }));

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as CurvesValue;
    const moved = last.rgb[1];
    expect(moved.x).toBeCloseTo(0.6, 1);
    expect(moved.y).toBeCloseTo(0.6, 1);
  });

  it('does not leak drag events between two independent editor instances', () => {
    // Pre-fix, every CurveEditor installed document-level mousemove
    // listeners, so dragging in editor A also drove editor B's handler
    // (with B's bounding rect, producing garbage). With per-SVG pointer
    // capture, editor B sees nothing.
    const aChange = vi.fn();
    const bChange = vi.fn();
    const value = makeValue([
      { x: 0,   y: 0   },
      { x: 0.5, y: 0.5 },
      { x: 1,   y: 1   },
    ]);
    const { container } = render(
      <>
        <CurveEditor value={value} onChange={aChange} channel="rgb" />
        <CurveEditor value={value} onChange={bChange} channel="rgb" />
      </>,
    );
    const svgs = Array.from(container.querySelectorAll('svg')) as SVGSVGElement[];
    stubSvg(svgs[0], { left: 0,   top: 0, width: 200, height: 200 });
    stubSvg(svgs[1], { left: 400, top: 0, width: 200, height: 200 });

    svgs[0].dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }));
    svgs[0].dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 80,  bubbles: true }));
    svgs[0].dispatchEvent(new PointerEvent('pointerup',   { clientX: 120, clientY: 80,  bubbles: true }));

    expect(aChange).toHaveBeenCalled();
    expect(bChange).not.toHaveBeenCalled();
  });
});
