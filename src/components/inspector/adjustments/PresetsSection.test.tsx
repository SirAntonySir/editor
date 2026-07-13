import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PresetsSection } from './PresetsSection';

vi.mock('@/lib/toolrail-spawn', () => ({
  spawnRegistryPreset: vi.fn(),
}));
vi.mock('@/lib/registry/loader', () => ({
  loadRegistry: () => ({
    ops: {},
    presets: {
      golden_hour: {
        id: 'golden_hour',
        display_name: 'Golden Hour',
        description: 'Warm sunset grade',
        category: 'tone',
        icon: 'wb_sunny',
      },
      cool_grade: {
        id: 'cool_grade',
        display_name: 'Cool Grade',
        description: 'Cyan-blue cast',
        category: 'tone',
        icon: 'ac_unit',
      },
      teal_orange: {
        id: 'teal_orange',
        display_name: 'Teal & Orange',
        description: 'Cinematic split-tone',
        category: 'look',
        icon: 'movie',
      },
    },
  }),
}));

import { spawnRegistryPreset } from '@/lib/toolrail-spawn';

describe('PresetsSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one button per preset category', () => {
    render(<PresetsSection />);
    expect(screen.getByRole('button', { name: /tone/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /look/i })).toBeTruthy();
  });

  it('opens a popover listing presets in the clicked category', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    expect(screen.getByText('Golden Hour')).toBeTruthy();
    expect(screen.getByText('Cool Grade')).toBeTruthy();
  });

  it('spawning a preset calls spawnRegistryPreset with the preset id + display name', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    fireEvent.click(screen.getByText('Golden Hour'));
    expect(spawnRegistryPreset).toHaveBeenCalledWith('golden_hour', 'Golden Hour');
  });

  it('tone category chip contains a swatch dot with data-strand-swatch="tone"', () => {
    render(<PresetsSection />);
    // The chip button's accessible name includes "Tone"; find it and check for swatch.
    const toneChip = screen.getByRole('button', { name: /tone/i });
    const swatch = toneChip.querySelector('[data-strand-swatch="tone"]');
    expect(swatch).not.toBeNull();
  });

  it('look category chip contains a swatch dot with data-strand-swatch="look"', () => {
    render(<PresetsSection />);
    const lookChip = screen.getByRole('button', { name: /look/i });
    const swatch = lookChip.querySelector('[data-strand-swatch="look"]');
    expect(swatch).not.toBeNull();
  });

  it('tone swatch dot uses the --strand-tone CSS variable', () => {
    render(<PresetsSection />);
    const toneChip = screen.getByRole('button', { name: /tone/i });
    const swatch = toneChip.querySelector('[data-strand-swatch="tone"]') as HTMLElement;
    expect(swatch.style.background).toMatch(/var\(--strand-tone\)/);
  });

  it('look swatch dot uses --strand-default CSS variable (no dedicated look token)', () => {
    render(<PresetsSection />);
    const lookChip = screen.getByRole('button', { name: /look/i });
    const swatch = lookChip.querySelector('[data-strand-swatch="look"]') as HTMLElement;
    expect(swatch.style.background).toMatch(/var\(--strand-default\)/);
  });

  it('popover preset rows contain swatch dots after opening the category', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    // After opening, there should be swatch dots inside the popover rows.
    // The mock has 2 tone presets; we expect 2 row swatches in the portal.
    const swatches = document.querySelectorAll('[data-strand-swatch="tone"]');
    // At least 3: one in the chip, two in the popover rows = 3 total.
    expect(swatches.length).toBeGreaterThanOrEqual(3);
  });
});
