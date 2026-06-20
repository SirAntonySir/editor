import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SemanticSection } from './SemanticSection';
import { makeFullContext } from './__fixtures__/enriched-context';

describe('SemanticSection — chip dispatch', () => {
  const originalDispatch = window.dispatchEvent.bind(window);
  const mockDispatch = vi.fn<typeof window.dispatchEvent>();

  beforeEach(() => {
    window.dispatchEvent = mockDispatch;
  });

  afterEach(() => {
    window.dispatchEvent = originalDispatch;
    mockDispatch.mockReset();
  });

  it('renders subject chips as buttons', () => {
    const ctx = makeFullContext();
    render(<SemanticSection ctx={ctx} />);
    // The fixture has subjects: ['train station platform at night', 'black locomotive']
    const btn = screen.getByRole('button', { name: /train station/i });
    expect(btn).toBeDefined();
  });

  it('clicking a subject chip dispatches spawn-palette:open with Subject label', async () => {
    const ctx = makeFullContext();
    render(<SemanticSection ctx={ctx} />);
    const btn = screen.getByRole('button', { name: /black locomotive/i });
    await userEvent.click(btn);
    const paletteCall = mockDispatch.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === 'spawn-palette:open',
    );
    expect(paletteCall).toBeDefined();
    const event = paletteCall![0] as CustomEvent;
    expect(event.detail.attachContext).toEqual([
      { label: 'Subject', value: 'black locomotive', sourceId: 'semantic:subject:black locomotive' },
    ]);
  });

  it('clicking a tone chip dispatches spawn-palette:open with Tone label', async () => {
    const ctx = makeFullContext();
    render(<SemanticSection ctx={ctx} />);
    // dominantTones: ['shadows', 'midtones']
    const btn = screen.getByRole('button', { name: /^shadows$/i });
    await userEvent.click(btn);
    const paletteCall = mockDispatch.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === 'spawn-palette:open',
    );
    expect(paletteCall).toBeDefined();
    const event = paletteCall![0] as CustomEvent;
    expect(event.detail.attachContext).toEqual([
      { label: 'Tone', value: 'shadows', sourceId: 'semantic:tone:shadows' },
    ]);
  });
});
