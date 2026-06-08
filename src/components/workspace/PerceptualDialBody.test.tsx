import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PerceptualDialBody } from './PerceptualDialBody';
import { TIME_OF_DAY_ANCHORS } from '@/processing/anchors/time-of-day-anchors';

afterEach(cleanup);

describe('PerceptualDialBody (1-D)', () => {
  it('renders one tick label per anchor', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    for (const a of TIME_OF_DAY_ANCHORS) {
      expect(screen.getByText(a.label)).toBeTruthy();
    }
  });

  it('exposes a range input bound to the current position', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    // Position 0.5 over a [0, 1000] internal range → value 500.
    expect(parseInt(input.value, 10)).toBe(500);
  });

  it('calls onPositionChange with a normalised [0, 1] value when the slider moves', () => {
    const onChange = vi.fn();
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0}
        onPositionChange={onChange}
      />,
    );
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '750' } });
    expect(onChange).toHaveBeenCalledWith(0.75);
  });

  it('renders a sky-temperature gradient strip (kelvin-driven)', () => {
    render(
      <PerceptualDialBody
        topology="1d-slider"
        anchors={TIME_OF_DAY_ANCHORS}
        position={0.5}
        onPositionChange={() => {}}
      />,
    );
    const strip = screen.getByTestId('dial-gradient-strip') as HTMLElement;
    expect(strip.style.background).toContain('linear-gradient');
  });
});
