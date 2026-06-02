import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { it, expect, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { BackendStatusBar } from './BackendStatusBar';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { usePreferencesStore } from '@/store/preferences-store';

// Make AnimatePresence/motion pass-through so enter/exit is synchronous in jsdom.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: new Proxy({}, { get: () => ({ children }: { children: ReactNode }) => <div>{children}</div> }),
}));

afterEach(cleanup);

/** Seed the "image context ready" state (sidebar starts collapsed). */
function seedReady() {
  useBackendState.setState({ phases: null, mcpAnalyzeComplete: false } as never);
  useAiSession.setState({ status: 'ready' } as never);
  usePreferencesStore.setState({ rightSidebarCollapsed: true, inspectorTab: 'adjustments' });
}

it('Show context opens the Info side panel and dismisses the bar', () => {
  seedReady();
  render(<BackendStatusBar />);
  expect(screen.getByText('Image context ready')).toBeTruthy();

  fireEvent.click(screen.getByText('Show context'));

  const p = usePreferencesStore.getState();
  expect(p.rightSidebarCollapsed).toBe(false); // sidebar opened
  expect(p.inspectorTab).toBe('info');          // Info tab selected
  expect(screen.queryByText('Image context ready')).toBeNull(); // bar dismissed
});

it('the ready line auto-dismisses after a beat', () => {
  vi.useFakeTimers();
  try {
    seedReady();
    render(<BackendStatusBar />);
    expect(screen.getByText('Image context ready')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Image context ready')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
