import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HslSectionBody } from './HslSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) } }));

const SCRUB_TITLE = 'Drag to scrub · click to type';

function seed(params: Record<string, number> = {}) {
  useBackendState.setState({
    sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: {
      session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: {
        id: 'g', userGoal: '', panelBindings: [], metadata: {},
        nodes: Object.keys(params).length
          ? [{ id: 'canon:L1:hsl', type: 'hsl', layer_id: 'L1', params }]
          : [],
      },
      revision: 1,
    } as never,
  } as never);
}

// Drive AdjustmentSlider's click-to-type path and commit a value.
function typeInto(scrubEl: Element, value: string) {
  fireEvent.pointerDown(scrubEl, { clientX: 0, pointerId: 1 });
  fireEvent.pointerUp(scrubEl, { clientX: 0, pointerId: 1 });
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  seed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('By band view shows the toggle, rail, and the active band\'s 3 sliders', () => {
  render(<HslSectionBody layerId="L1" />);
  expect(screen.getByText('By band')).toBeTruthy();
  expect(screen.getByText('By channel')).toBeTruthy();
  expect(screen.getAllByRole('slider').length).toBe(3);
});

it('By channel view shows 8 band sliders', () => {
  render(<HslSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('By channel'));
  expect(screen.getAllByRole('slider').length).toBe(8);
});

it('moving a band slider writes the <band>_<channel> param (default band = red)', () => {
  render(<HslSectionBody layerId="L1" />);
  typeInto(screen.getAllByTitle(SCRUB_TITLE)[0], '30'); // index 0 = Hue
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'hsl', param: 'red_hue', value: 30 });
});

it('selecting a band routes writes to that band', () => {
  render(<HslSectionBody layerId="L1" />);
  fireEvent.click(screen.getByLabelText('Select Orange'));
  typeInto(screen.getAllByTitle(SCRUB_TITLE)[1], '-20'); // index 1 = Sat
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'hsl', param: 'orange_sat', value: -20 });
});

it('channel view maps the row + active tab to the right param', () => {
  render(<HslSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('By channel'));
  fireEvent.click(screen.getByText('Sat'));
  typeInto(screen.getAllByTitle(SCRUB_TITLE)[5], '40'); // row 5 = blue
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'hsl', param: 'blue_sat', value: 40 });
});

it('marks exactly the edited bands in the rail', () => {
  seed({ orange_sat: 30 });
  render(<HslSectionBody layerId="L1" />);
  expect(screen.getAllByTestId('hsl-edited-dot').length).toBe(1);
});

it('Reset zeroes a non-default param', () => {
  seed({ orange_sat: 30 });
  render(<HslSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('Reset'));
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'hsl', param: 'orange_sat', value: 0 });
});
