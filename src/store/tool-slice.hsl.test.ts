import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('hslRevealedBands', () => {
  beforeEach(() => useEditorStore.setState({ hslRevealedBands: {} }));

  it('reveals bands per widget, deduped and order-preserving', () => {
    const { revealHslBand } = useEditorStore.getState();
    revealHslBand('w1', 'blue');
    revealHslBand('w1', 'blue'); // dupe ignored
    revealHslBand('w1', 'green');
    revealHslBand('w2', 'red'); // isolated per widget
    expect(useEditorStore.getState().hslRevealedBands['w1']).toEqual(['blue', 'green']);
    expect(useEditorStore.getState().hslRevealedBands['w2']).toEqual(['red']);
  });
});
