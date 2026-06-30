import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { RegionSuggestions } from './RegionSuggestions';
import type { PaletteElement } from '@/lib/region-suggest';

afterEach(cleanup);

const REGIONS: PaletteElement[] = [
  { kind: 'region', label: 'shoes', sourceId: 'region:object:m1' },
  { kind: 'region', label: 'shirt', sourceId: 'region:object:m2' },
];

const anchor = { left: 10, bottom: 20, top: 12, right: 40, width: 30, height: 8 } as DOMRect;

it('renders nothing when there are no regions', () => {
  const { container } = render(
    <RegionSuggestions
      elements={[]}
      activeIndex={0}
      anchorRect={anchor}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );
  expect(container.firstChild).toBeNull();
});

it('renders a row per region', () => {
  render(
    <RegionSuggestions
      elements={REGIONS}
      activeIndex={0}
      anchorRect={anchor}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );
  expect(screen.getByText('shoes')).toBeTruthy();
  expect(screen.getByText('shirt')).toBeTruthy();
});

it('marks the active row', () => {
  render(
    <RegionSuggestions
      elements={REGIONS}
      activeIndex={1}
      anchorRect={anchor}
      onSelect={() => {}}
      onHover={() => {}}
    />,
  );
  const active = screen.getByText('shirt').closest('[data-active]')!;
  expect(active.getAttribute('data-active')).toBe('true');
  const inactive = screen.getByText('shoes').closest('[data-active]')!;
  expect(inactive.getAttribute('data-active')).toBe('false');
});

it('calls onSelect with the clicked region', () => {
  const onSelect = vi.fn();
  render(
    <RegionSuggestions
      elements={REGIONS}
      activeIndex={0}
      anchorRect={anchor}
      onSelect={onSelect}
      onHover={() => {}}
    />,
  );
  fireEvent.mouseDown(screen.getByText('shirt'));
  expect(onSelect).toHaveBeenCalledWith(REGIONS[1]);
});
