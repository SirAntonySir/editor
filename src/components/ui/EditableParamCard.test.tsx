import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { EditableParamCard } from './EditableParamCard';

afterEach(() => cleanup());

const baseProps = {
  label: 'Contrast',
  value: 25,
  min: -100,
  max: 100,
  step: 1,
  onChange: vi.fn(),
  onUnlock: vi.fn(),
  onLock: vi.fn(),
};

describe('EditableParamCard lock control', () => {
  it('shows the closed-lock icon and accent style when locked', () => {
    render(<EditableParamCard {...baseProps} locked={true} />);
    const btn = screen.getByRole('button', { name: /unlock contrast/i });
    expect(btn.className).toContain('text-[var(--color-accent)]');
    expect(btn.className).toContain('opacity-100');
  });

  it('shows the open-lock icon as a low-opacity discoverable affordance on an unlocked card', () => {
    render(<EditableParamCard {...baseProps} locked={false} />);
    const btn = screen.getByRole('button', { name: /lock contrast/i });
    // Unlocked starts at a low opacity so the user can find the lock without
    // a hover-reveal. The button is fully clickable — pointer-events not
    // removed (the actual bug the user reported).
    expect(btn.className).toContain('opacity-40');
    expect(btn.className).not.toContain('pointer-events-none');
  });

  it('calls onUnlock when clicking the lock on a locked card', () => {
    const onUnlock = vi.fn();
    const onLock = vi.fn();
    render(<EditableParamCard {...baseProps} locked={true} onUnlock={onUnlock} onLock={onLock} />);
    fireEvent.click(screen.getByRole('button', { name: /unlock contrast/i }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(onLock).not.toHaveBeenCalled();
  });

  it('calls onLock when clicking the lock on an unlocked card', () => {
    const onUnlock = vi.fn();
    const onLock = vi.fn();
    render(<EditableParamCard {...baseProps} locked={false} onUnlock={onUnlock} onLock={onLock} />);
    fireEvent.click(screen.getByRole('button', { name: /lock contrast/i }));
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(onUnlock).not.toHaveBeenCalled();
  });
});

describe('EditableParamCard editing precision', () => {
  it('rounds interpolated floats to step precision when entering edit mode', () => {
    // Step=1 → an interpolated 18.029679421941786 must enter the input as "18",
    // not the full float. This was the user-reported bug.
    render(
      <EditableParamCard
        {...baseProps}
        locked={false}
        value={18.029679421941786}
        step={1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit contrast/i }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('18');
  });

  it('keeps one decimal when step is 0.1', () => {
    render(
      <EditableParamCard
        {...baseProps}
        locked={false}
        value={18.029679421941786}
        step={0.1}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /edit contrast/i }));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('18.0');
  });
});
