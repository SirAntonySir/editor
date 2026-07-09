import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  aiAccess: { value: true },
  correct_problem: vi.fn(async () => ({ ok: true, output: { widget: {} } })),
}));

vi.mock('@/lib/ai-access', () => ({
  useAiAccess: () => mocks.aiAccess.value,
}));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { correct_problem: mocks.correct_problem },
}));
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: Object.assign(
    (selector: (s: object) => unknown) => selector({ sessionId: 'sid-1', sseStatus: 'open' }),
    { getState: () => ({ sessionId: 'sid-1', sseStatus: 'open' }) },
  ),
}));
vi.mock('@/hooks/useImageContext', () => ({
  resolveTargetImageLayerId: () => 'l-1',
}));

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

describe('ProblemsSection — Correct action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aiAccess.value = true;
  });
  afterEach(cleanup);

  it('never shows raw fused tool ids', () => {
    render(<ProblemsSection ctx={makeFullContext()} />);
    // Internal template ids (shadows_lift etc.) are implementation detail —
    // the user sees a Correct action instead.
    expect(document.body.textContent).not.toMatch(/_/);
  });

  it('renders one Correct button per problem in the AI condition', () => {
    render(<ProblemsSection ctx={makeFullContext()} />);
    expect(screen.getAllByRole('button', { name: /^correct/i })).toHaveLength(1);
  });

  it('clicking Correct mints the correction for the problem', async () => {
    render(<ProblemsSection ctx={makeFullContext()} />);
    await userEvent.click(screen.getByRole('button', { name: /^correct/i }));
    await waitFor(() =>
      expect(mocks.correct_problem).toHaveBeenCalledWith('sid-1', {
        problemKind: 'crushed_shadows',
        regionLabel: 'foreground',
        layerId: 'l-1',
      }),
    );
  });

  it('hides the Correct button in the baseline condition', () => {
    mocks.aiAccess.value = false;
    render(<ProblemsSection ctx={makeFullContext()} />);
    expect(screen.queryByRole('button', { name: /^correct/i })).toBeNull();
    // Baseline still never leaks internal ids.
    expect(document.body.textContent).not.toMatch(/shadows_lift/);
  });
});
