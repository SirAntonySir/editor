import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemsSection } from './ProblemsSection';
import { makeFullContext } from './__fixtures__/enriched-context';

describe('ProblemsSection — chip dispatch', () => {
  const originalDispatch = window.dispatchEvent.bind(window);
  const mockDispatch = vi.fn<typeof window.dispatchEvent>();

  beforeEach(() => {
    window.dispatchEvent = mockDispatch;
  });

  afterEach(() => {
    window.dispatchEvent = originalDispatch;
    mockDispatch.mockReset();
  });

  it('renders problem kind chips as buttons', () => {
    const ctx = makeFullContext();
    render(<ProblemsSection ctx={ctx} />);
    // Fixture has one problem: { kind: 'crushed_shadows', ... }
    const btn = screen.getByRole('button', { name: /crushed shadows/i });
    expect(btn).toBeDefined();
  });

  it('clicking a problem chip dispatches spawn-palette:open with Problem label', async () => {
    const ctx = makeFullContext();
    render(<ProblemsSection ctx={ctx} />);
    const btn = screen.getByRole('button', { name: /crushed shadows/i });
    await userEvent.click(btn);
    const paletteCall = mockDispatch.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === 'spawn-palette:open',
    );
    expect(paletteCall).toBeDefined();
    const event = paletteCall![0] as CustomEvent;
    const [item] = event.detail.attachContext as Array<{ label: string; value: string; sourceId: string }>;
    expect(item.label).toBe('Problem');
    expect(item.sourceId).toBe('problem:crushed_shadows');
    // Value should include the kind label, severity %, and region label
    expect(item.value).toMatch(/crushed shadows/i);
    expect(item.value).toMatch(/60\.0%/);
    expect(item.value).toMatch(/foreground/);
  });

  it('shows "No issues detected." when problems array is empty', () => {
    const ctx = { ...makeFullContext(), problems: [] };
    render(<ProblemsSection ctx={ctx} />);
    expect(screen.getByText('No issues detected.')).toBeDefined();
    expect(screen.queryByRole('button', { name: /crushed shadows/i })).toBeNull();
  });
});
