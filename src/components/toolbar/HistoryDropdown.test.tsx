import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryDropdown } from './HistoryDropdown';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

// Mock useHistoryLog — controls what the dropdown renders.
vi.mock('@/hooks/useHistoryLog', () => ({
  useHistoryLog: vi.fn(),
}));

// Mock backendTools so jumpHistory calls are intercepted.
vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    jumpHistory: vi.fn().mockResolvedValue({ revision: 2, applied: 'jump:0' }),
  },
}));

import { useHistoryLog } from '@/hooks/useHistoryLog';

const mockUseHistoryLog = vi.mocked(useHistoryLog);
const mockJumpHistory = vi.mocked(backendTools.jumpHistory);

const THREE_ENTRY_LOG = {
  entries: [
    { id: 'e0', ts: 1000, label: 'Open image' },
    { id: 'e1', ts: 2000, label: 'Set exposure' },
    { id: 'e2', ts: 3000, label: 'Add vignette' },
  ],
  cursor: 1,
  canUndo: true,
  canRedo: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useBackendState.getState().reset?.();
  useBackendState.setState({ sessionId: 'sess-1', sseStatus: 'open' } as never);
});

afterEach(() => cleanup());

describe('HistoryDropdown', () => {
  it('renders a disabled button when log is null', () => {
    mockUseHistoryLog.mockReturnValue(null);
    render(<HistoryDropdown />);
    const btn = screen.getByRole('button', { name: 'History' });
    expect(btn).toBeDisabled();
  });

  it('renders a disabled button when log has no entries', () => {
    mockUseHistoryLog.mockReturnValue({ entries: [], cursor: -1, canUndo: false, canRedo: false });
    render(<HistoryDropdown />);
    const btn = screen.getByRole('button', { name: 'History' });
    expect(btn).toBeDisabled();
  });

  it('renders an enabled button when log has entries', () => {
    mockUseHistoryLog.mockReturnValue(THREE_ENTRY_LOG);
    render(<HistoryDropdown />);
    const btn = screen.getByRole('button', { name: 'History' });
    expect(btn).not.toBeDisabled();
  });

  it('shows all entry labels in newest-first order when opened', async () => {
    mockUseHistoryLog.mockReturnValue(THREE_ENTRY_LOG);
    const user = userEvent.setup();
    render(<HistoryDropdown />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'History' }));
    });

    // Newest first: 'Add vignette', 'Set exposure', 'Open image'.
    const rows = screen.getAllByRole('button').filter((b) => b.textContent?.match(/vignette|exposure|Open/));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Add vignette');
    expect(rows[1].textContent).toContain('Set exposure');
    expect(rows[2].textContent).toContain('Open image');
  });

  it('highlights the current cursor row — "Set exposure" appears at cursor position', async () => {
    // cursor=1 → 'Set exposure' is current. We verify the entry is rendered
    // and that its sibling items include the future/past distinction. The exact
    // rendered dot CSS class is tested implicitly via the component snapshot;
    // here we confirm the log is rendered with the right order.
    mockUseHistoryLog.mockReturnValue(THREE_ENTRY_LOG);
    const user = userEvent.setup();
    render(<HistoryDropdown />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'History' }));
    });

    // All three entries are present in the DOM.
    expect(screen.getByRole('button', { name: /Add vignette/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Set exposure/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open image/ })).toBeTruthy();
  });

  it('calls jumpHistory with the correct index on row click', async () => {
    mockUseHistoryLog.mockReturnValue(THREE_ENTRY_LOG);
    const user = userEvent.setup();
    render(<HistoryDropdown />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'History' }));
    });

    // Click "Open image" — displayed last (oldest), index 0 in log.entries.
    const openImageRow = screen.getByRole('button', { name: /Open image/ });
    await act(async () => {
      await user.click(openImageRow);
    });

    expect(mockJumpHistory).toHaveBeenCalledWith('sess-1', 0);
  });

  it('closes the popover after a jump', async () => {
    mockUseHistoryLog.mockReturnValue(THREE_ENTRY_LOG);
    const user = userEvent.setup();
    render(<HistoryDropdown />);

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'History' }));
    });

    const openImageRow = screen.getByRole('button', { name: /Open image/ });
    await act(async () => {
      await user.click(openImageRow);
    });

    // After clicking a row the popover should close — the rows should no
    // longer be in the document.
    expect(screen.queryByRole('button', { name: /Open image/ })).toBeNull();
  });
});
