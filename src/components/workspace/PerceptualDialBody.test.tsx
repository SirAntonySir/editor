import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PerceptualDialBody } from './PerceptualDialBody';
import { loadRegistry } from '@/lib/registry/loader';
import type { Anchor } from '@/lib/perceptual-dial/types';

/** Build the TOD anchor list from the shared registry (same source used by
 *  CompoundWidgetBody at runtime). */
function todAnchors(): Anchor[] {
  const op = loadRegistry().ops['time-of-day'];
  if (!op?.compound) return [];
  return op.compound.anchors.map((a) => ({
    id: a.name,
    label: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    position: [a.position],
    params: a.values,
  }));
}

const TIME_OF_DAY_ANCHORS: Anchor[] = todAnchors();

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
