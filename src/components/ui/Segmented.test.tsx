import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { Segmented } from './Segmented';

afterEach(cleanup);

const opts = [
  { value: 'band', label: 'By band' },
  { value: 'channel', label: 'By channel' },
];

it('renders a button per option', () => {
  render(<Segmented options={opts} value="band" onChange={() => {}} />);
  expect(screen.getByText('By band')).toBeTruthy();
  expect(screen.getByText('By channel')).toBeTruthy();
});

it('marks the active option with data-state="on"', () => {
  render(<Segmented options={opts} value="channel" onChange={() => {}} />);
  const active = screen.getByText('By channel').closest('button')!;
  const inactive = screen.getByText('By band').closest('button')!;
  expect(active.getAttribute('data-state')).toBe('on');
  expect(inactive.getAttribute('data-state')).toBe('off');
});

it('calls onChange with the clicked option value', () => {
  const onChange = vi.fn();
  render(<Segmented options={opts} value="band" onChange={onChange} />);
  fireEvent.click(screen.getByText('By channel'));
  expect(onChange).toHaveBeenCalledWith('channel');
});

it('ignores a click on the already-active option (no empty deselect)', () => {
  const onChange = vi.fn();
  render(<Segmented options={opts} value="band" onChange={onChange} />);
  fireEvent.click(screen.getByText('By band'));
  expect(onChange).not.toHaveBeenCalled();
});
