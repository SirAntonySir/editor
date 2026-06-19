import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionsSection } from './RegionsSection';
import { makeFullContext } from './__fixtures__/enriched-context';

// RegionThumbnail renders a canvas; mock it to avoid canvas API issues in jsdom.
vi.mock('./RegionThumbnail', () => ({
  RegionThumbnail: () => null,
}));

describe('RegionsSection — chip dispatch', () => {
  const originalDispatch = window.dispatchEvent.bind(window);
  const mockDispatch = vi.fn<typeof window.dispatchEvent>();

  beforeEach(() => {
    window.dispatchEvent = mockDispatch;
  });

  afterEach(() => {
    window.dispatchEvent = originalDispatch;
    mockDispatch.mockReset();
  });

  it('renders region label as a button', () => {
    const ctx = makeFullContext();
    render(<RegionsSection ctx={ctx} />);
    // Fixture candidateRegions: [{ label: 'sky', ... }, { label: 'locomotive', ... }]
    expect(screen.getByRole('button', { name: /sky/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /locomotive/i })).toBeDefined();
  });

  it('clicking a region label dispatches spawn-palette:open with Region label', async () => {
    const ctx = makeFullContext();
    render(<RegionsSection ctx={ctx} />);
    const btn = screen.getByRole('button', { name: /^sky$/i });
    await userEvent.click(btn);
    const paletteCall = mockDispatch.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === 'spawn-palette:open',
    );
    expect(paletteCall).toBeDefined();
    const event = paletteCall![0] as CustomEvent;
    const [item] = event.detail.attachContext as Array<{ label: string; value: string; sourceId: string }>;
    expect(item.label).toBe('Region');
    expect(item.sourceId).toBe('region:sky');
    // value is the region label (no area weight in fixture since regionStats is [])
    expect(item.value).toBe('sky');
  });
});
