import { describe, it, expect } from 'vitest';
import type { Widget } from '@/types/widget';
import { makeHslWidget } from '@/components/widget/__fixtures__/widgets';
import { HSL_BANDS } from './hsl-bands';
import { editedHslBands, availableHslBands, shownHslBands } from './hsl-shown-bands';

const ALL_BANDS = HSL_BANDS.map((b) => b.key);

/** Return a copy of `widget` with the given param keys nudged off their default. */
function withEdited(widget: Widget, ...paramKeys: string[]): Widget {
  return {
    ...widget,
    bindings: widget.bindings.map((b) =>
      paramKeys.includes(b.paramKey) ? { ...b, value: 10 } : b,
    ),
  };
}

describe('editedHslBands', () => {
  it('lists only bands with a non-default channel', () => {
    const w = withEdited(makeHslWidget(ALL_BANDS), 'blue_sat', 'orange_hue');
    expect(editedHslBands(w)).toEqual(['orange', 'blue']); // canonical band order
  });

  it('is empty when every channel rests at default', () => {
    expect(editedHslBands(makeHslWidget(ALL_BANDS))).toEqual([]);
  });
});

describe('availableHslBands', () => {
  it('is every band a full-24 widget binds', () => {
    expect(availableHslBands(makeHslWidget(ALL_BANDS))).toEqual(ALL_BANDS);
  });

  it('is only the bands a subset widget binds', () => {
    expect(availableHslBands(makeHslWidget(['red', 'blue']))).toEqual(['red', 'blue']);
  });
});

describe('shownHslBands', () => {
  it('falls back to the first available band when nothing is edited or revealed', () => {
    expect(shownHslBands(makeHslWidget(ALL_BANDS), [])).toEqual(['red']);
  });

  it('shows a revealed band even when nothing is edited', () => {
    expect(shownHslBands(makeHslWidget(ALL_BANDS), ['blue'])).toEqual(['blue']);
  });

  it('unions edited and revealed bands in canonical order', () => {
    const w = withEdited(makeHslWidget(ALL_BANDS), 'red_hue');
    expect(shownHslBands(w, ['blue'])).toEqual(['red', 'blue']);
  });

  it('ignores revealed bands the widget does not bind', () => {
    // subset widget binds only red+blue; revealing 'green' (unbound) is dropped.
    expect(shownHslBands(makeHslWidget(['red', 'blue']), ['green'])).toEqual(['red']);
  });
});
