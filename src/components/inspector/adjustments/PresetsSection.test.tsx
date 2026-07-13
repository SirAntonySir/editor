import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PresetsSection } from './PresetsSection';
import { useEditorStore } from '@/store';

vi.mock('@/lib/palette-inspector-route', () => ({
  dispatchPreset: vi.fn(),
}));
vi.mock('@/lib/preset-thumbs', () => ({
  // Resolve a real (drawable) canvas standing in for the ImageBitmap — jsdom's
  // drawImage rejects plain objects.
  getPresetThumb: vi.fn(async () => {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 54;
    return c as unknown as ImageBitmap;
  }),
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
        ops: [],
      },
      cool_grade: {
        id: 'cool_grade',
        display_name: 'Cool Grade',
        description: 'Cyan-blue cast',
        category: 'tone',
        ops: [],
      },
      teal_orange: {
        id: 'teal_orange',
        display_name: 'Teal & Orange',
        description: 'Cinematic split-tone',
        category: 'look',
        ops: [],
      },
    },
  }),
}));

import { dispatchPreset } from '@/lib/palette-inspector-route';
import { getPresetThumb } from '@/lib/preset-thumbs';

describe('PresetsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({
      expandedSectionIds: new Set<string>(),
      activeLayerId: 'L1',
    } as never);
  });

  it('renders one accordion row per category with a strand swatch', () => {
    render(<PresetsSection />);
    const tone = screen.getByRole('button', { name: /tone/i });
    const look = screen.getByRole('button', { name: /look/i });
    expect(tone.querySelector('[data-strand-swatch="tone"]')).not.toBeNull();
    expect(look.querySelector('[data-strand-swatch="look"]')).not.toBeNull();
  });

  it('keeps preset rows hidden until the category is expanded', () => {
    render(<PresetsSection />);
    expect(screen.queryByText('Golden Hour')).toBeNull();
    expect(screen.queryByText('Teal & Orange')).toBeNull();
  });

  it('clicking a category header expands it via expandedSectionIds', () => {
    render(<PresetsSection />);
    fireEvent.click(screen.getByRole('button', { name: /tone/i }));
    expect(screen.getByText('Golden Hour')).toBeTruthy();
    expect(screen.getByText('Cool Grade')).toBeTruthy();
    expect(useEditorStore.getState().expandedSectionIds.has('preset:tone')).toBe(true);
    // Other categories stay collapsed.
    expect(screen.queryByText('Teal & Orange')).toBeNull();
  });

  it('honours pre-expanded state from the store', () => {
    useEditorStore.setState({ expandedSectionIds: new Set(['preset:look']) } as never);
    render(<PresetsSection />);
    expect(screen.getByText('Teal & Orange')).toBeTruthy();
  });

  it('shows the preset description in the row', () => {
    useEditorStore.setState({ expandedSectionIds: new Set(['preset:tone']) } as never);
    render(<PresetsSection />);
    expect(screen.getByText('Warm sunset grade')).toBeTruthy();
  });

  it('clicking a preset row dispatches it (id + display name)', () => {
    useEditorStore.setState({ expandedSectionIds: new Set(['preset:tone']) } as never);
    render(<PresetsSection />);
    fireEvent.click(screen.getByText('Golden Hour'));
    expect(dispatchPreset).toHaveBeenCalledWith('golden_hour', 'Golden Hour');
  });

  it('requests one thumbnail per preset for the active layer when expanded', async () => {
    useEditorStore.setState({ expandedSectionIds: new Set(['preset:tone']) } as never);
    render(<PresetsSection />);
    await waitFor(() => {
      expect(getPresetThumb).toHaveBeenCalledWith('golden_hour', 'L1');
      expect(getPresetThumb).toHaveBeenCalledWith('cool_grade', 'L1');
    });
    // Collapsed categories cost nothing.
    expect(getPresetThumb).not.toHaveBeenCalledWith('teal_orange', 'L1');
  });

  it('renders a placeholder and skips rendering when there is no active layer', () => {
    useEditorStore.setState({
      activeLayerId: null,
      expandedSectionIds: new Set(['preset:tone']),
    } as never);
    render(<PresetsSection />);
    expect(screen.getAllByTestId('preset-thumb-placeholder').length).toBe(2);
    expect(getPresetThumb).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when the thumbnail render fails', async () => {
    vi.mocked(getPresetThumb).mockResolvedValue(null);
    useEditorStore.setState({ expandedSectionIds: new Set(['preset:tone']) } as never);
    render(<PresetsSection />);
    await waitFor(() => expect(getPresetThumb).toHaveBeenCalled());
    expect(screen.getAllByTestId('preset-thumb-placeholder').length).toBe(2);
  });
});
