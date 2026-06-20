import { render, screen, cleanup } from '@testing-library/react';
import { it, expect, afterEach } from 'vitest';
import { AdjustmentSlider } from './AdjustmentSlider';

afterEach(cleanup);

// Regression guard: the default (no trackGradient) keeps the hidden-thumb,
// fill-from-min look every existing caller relies on.
it('hides the thumb and renders the fill by default', () => {
  const { container } = render(<AdjustmentSlider label="Exposure" value={0} min={-100} max={100} onChange={() => {}} />);
  expect(screen.getByRole('slider').className).toContain('opacity-0');
  expect(container.querySelector('[style*="color-mix"]')).toBeTruthy(); // fill present
});

// New behaviour: a colour track paints the gradient and shows a visible thumb
// (the thumb now carries provenance, since the track is colour, not fill).
it('with trackGradient paints the gradient and shows a visible thumb', () => {
  const grad = 'linear-gradient(90deg, hsl(210 85% 55%), hsl(240 85% 55%), hsl(270 85% 55%))';
  const { container } = render(
    <AdjustmentSlider
      label="Hue"
      value={0}
      min={-100}
      max={100}
      trackGradient={grad}
      provenance="hand"
      onChange={() => {}}
    />,
  );
  // Specific to the gradient we pass — the default Range fill also uses a
  // linear-gradient (accent), so assert on a stop unique to this track.
  expect(container.querySelector('[style*="hsl(240 85% 55%)"]')).toBeTruthy();
  expect(screen.getByRole('slider').className).not.toContain('opacity-0');
  // The fill-from-min Range is omitted in colour-track mode (no double track).
  expect(container.querySelector('[style*="color-mix"]')).toBeNull();
});
