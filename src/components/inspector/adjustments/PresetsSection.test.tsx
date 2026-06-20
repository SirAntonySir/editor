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
});
