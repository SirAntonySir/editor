import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { RefineInput } from './RefineInput';

afterEach(cleanup);

describe('RefineInput', () => {
  it('submits the typed instruction on Enter', () => {
    const onSubmit = vi.fn();
    render(<RefineInput onSubmit={onSubmit} onCancel={() => {}} pending={false} />);
    const input = screen.getByRole('textbox', { name: /refine instruction/i });
    fireEvent.change(input, { target: { value: 'stronger' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('stronger');
  });
  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<RefineInput onSubmit={() => {}} onCancel={onCancel} pending={false} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
  it('disables the input + button while pending', () => {
    render(<RefineInput onSubmit={() => {}} onCancel={() => {}} pending />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});
