// @vitest-environment jsdom
/**
 * Tests for the TopMarginalia header affordances:
 *  - the bulb "Suggest something" button replaces the old "Analyze with AI"
 *    header button (analyze stays menu-only)
 *  - bulb visibility follows showSuggest (aiAccess && !offline upstream)
 *  - busy state disables the bulb while a suggest/analyze run is in flight
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopMarginalia } from './TopMarginalia';

vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }));

function renderMarginalia(props: Partial<Parameters<typeof TopMarginalia>[0]> = {}) {
  return render(
    <TopMarginalia
      title="photo"
      onCompareDown={() => {}}
      onCompareUp={() => {}}
      renderMenuItems={() => null}
      {...props}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('TopMarginalia suggest button', () => {
  it('renders the bulb and fires onSuggest on click', async () => {
    const onSuggest = vi.fn();
    renderMarginalia({ showSuggest: true, onSuggest });
    const btn = screen.getByRole('button', { name: 'Suggest something' });
    await userEvent.click(btn);
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });

  it('hides the bulb when showSuggest is false', () => {
    renderMarginalia({ showSuggest: false, onSuggest: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Suggest something' })).toBeNull();
  });

  it('disables the bulb while busy and does not fire onSuggest', async () => {
    const onSuggest = vi.fn();
    renderMarginalia({ showSuggest: true, onSuggest, suggestBusy: true });
    const btn = screen.getByRole('button', { name: 'Suggest something' });
    expect(btn).toHaveProperty('disabled', true);
    await userEvent.click(btn);
    expect(onSuggest).not.toHaveBeenCalled();
  });

  it('swaps the bulb for a spinner while busy', () => {
    renderMarginalia({ showSuggest: true, onSuggest: vi.fn(), suggestBusy: true });
    const btn = screen.getByRole('button', { name: 'Suggest something' });
    expect(btn.querySelector('.animate-spin')).not.toBeNull();
  });

  it('shows the plain bulb (no spinner) when idle', () => {
    renderMarginalia({ showSuggest: true, onSuggest: vi.fn(), suggestBusy: false });
    const btn = screen.getByRole('button', { name: 'Suggest something' });
    expect(btn.querySelector('.animate-spin')).toBeNull();
  });

  it('no longer renders the header "Analyze with AI" button', () => {
    renderMarginalia({ showSuggest: true, onSuggest: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Analyze with AI' })).toBeNull();
  });
});
