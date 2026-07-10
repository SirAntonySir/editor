import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { HslWidgetBody } from './HslWidgetBody';
import { makeHslWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import type { ControlBinding, Widget } from '@/types/widget';

afterEach(cleanup);
beforeEach(() => useEditorStore.setState({ hslRevealedBands: {} }));

const SCRUB_TITLE = 'Drag to scrub · click to type';
const ALL = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const eff = (b: ControlBinding) => b.value;

function withEdited(widget: Widget, ...keys: string[]): Widget {
  return {
    ...widget,
    bindings: widget.bindings.map((b) => (keys.includes(b.paramKey) ? { ...b, value: 10 } : b)),
  };
}

it('renders the full two-view panel once 2+ bands are shown', () => {
  // An all-bands widget with two edited bands shows both — the two-view panel.
  render(
    <HslWidgetBody
      widget={withEdited(makeHslWidget(ALL), 'red_hue', 'blue_sat')}
      effectiveValue={eff}
      setParam={() => {}}
    />,
  );
  expect(screen.getByText('By band')).toBeTruthy();
  expect(screen.getByText('By channel')).toBeTruthy();
  expect(screen.getAllByRole('slider').length).toBe(3); // band view → active band's 3
});

it('renders a single 3-slider body (no view toggle) for a single-band widget', () => {
  render(<HslWidgetBody widget={makeHslWidget(['blue'])} effectiveValue={eff} setParam={() => {}} />);
  expect(screen.queryByText('By band')).toBeNull();
  expect(screen.queryByText('By channel')).toBeNull();
  expect(screen.getAllByRole('slider').length).toBe(3);
});

it('a slider change calls setParam with the binding param key', () => {
  const setParam = vi.fn();
  render(<HslWidgetBody widget={makeHslWidget(['blue'])} effectiveValue={eff} setParam={setParam} />);
  const nums = screen.getAllByTitle(SCRUB_TITLE); // blue_hue, blue_sat, blue_lum
  fireEvent.pointerDown(nums[1], { clientX: 0, pointerId: 1 });
  fireEvent.pointerUp(nums[1], { clientX: 0, pointerId: 1 });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '20' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  expect(setParam).toHaveBeenCalledWith('blue_sat', 20);
});
