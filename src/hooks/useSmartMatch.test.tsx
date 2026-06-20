/**
 * useSmartMatch — palette typing-time AI matcher.
 *
 * The hook's whole job is to *not* fire the backend tool except under tight
 * conditions, and to cancel an in-flight call when a newer query arrives.
 * These tests pin each gate (min chars, session, analyze-complete, enabled,
 * SSE open) plus the debounce + abort-on-supersede behaviour.
 *
 * Real timers + `await act(() => ...)` are used so the effect's setTimeout
 * runs naturally. The `backendTools.smart_match_command` call is spied to
 * keep the test deterministic and to assert what was sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSmartMatch } from './useSmartMatch';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { RUNTIME } from '@/config';

function setSession(sessionId: string | null, opts: { ready: boolean }) {
  useBackendState.setState({
    sessionId,
    sseStatus: opts.ready ? 'open' : 'closed',
    mcpAnalyzeComplete: opts.ready,
  });
}

beforeEach(() => {
  useBackendState.setState({
    sessionId: null,
    sseStatus: 'closed',
    mcpAnalyzeComplete: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSmartMatch — gates that skip the backend call', () => {
  it('does not call when disabled', async () => {
    setSession('sid', { ready: true });
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks: [] } });
    renderHook(() => useSmartMatch('moody scene please', { enabled: false }));
    await new Promise((r) => setTimeout(r, RUNTIME.smartMatchDebounceMs + 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call when query is shorter than smartMatchMinChars', async () => {
    setSession('sid', { ready: true });
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks: [] } });
    // smartMatchMinChars = 4 — three chars is below the bar even after trim.
    renderHook(() => useSmartMatch('mod', { enabled: true }));
    await new Promise((r) => setTimeout(r, RUNTIME.smartMatchDebounceMs + 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call when SSE is closed', async () => {
    setSession('sid', { ready: false });
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks: [] } });
    renderHook(() => useSmartMatch('moody scene', { enabled: true }));
    await new Promise((r) => setTimeout(r, RUNTIME.smartMatchDebounceMs + 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call before analyze completes (no image_context available)', async () => {
    // SSE open but mcpAnalyzeComplete still false — the backend tool's
    // permission gate would reject anyway; the hook skips it client-side
    // so we don't burn the rate limiter.
    useBackendState.setState({
      sessionId: 'sid',
      sseStatus: 'open',
      mcpAnalyzeComplete: false,
    });
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks: [] } });
    renderHook(() => useSmartMatch('moody scene', { enabled: true }));
    await new Promise((r) => setTimeout(r, RUNTIME.smartMatchDebounceMs + 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call without a session id', async () => {
    setSession(null, { ready: true });
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks: [] } });
    renderHook(() => useSmartMatch('moody scene', { enabled: true }));
    await new Promise((r) => setTimeout(r, RUNTIME.smartMatchDebounceMs + 30));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useSmartMatch — happy path', () => {
  it('fires after debounce and returns picks', async () => {
    setSession('sid-1', { ready: true });
    const picks = [{ kind: 'op' as const, id: 'kelvin', reason: 'warm fits query' }];
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({ ok: true, output: { picks } });
    const { result } = renderHook(() => useSmartMatch('warmer', { enabled: true }));
    expect(spy).not.toHaveBeenCalled();
    await waitFor(
      () => expect(spy).toHaveBeenCalledTimes(1),
      { timeout: RUNTIME.smartMatchDebounceMs + 200 },
    );
    expect(spy).toHaveBeenCalledWith('sid-1', { query: 'warmer' }, expect.any(AbortSignal));
    await waitFor(() => expect(result.current.picks).toEqual(picks));
    expect(result.current.loading).toBe(false);
  });

  it('soft-fails on a !ok envelope (rate-limit, permission, etc) and stays empty', async () => {
    setSession('sid-1', { ready: true });
    vi.spyOn(backendTools, 'smart_match_command').mockResolvedValue({
      ok: false,
      error: { code: 'rate_limited', message: 'rate limited', retryable: true },
    });
    const { result } = renderHook(() => useSmartMatch('foggy night', { enabled: true }));
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: RUNTIME.smartMatchDebounceMs + 300 });
    expect(result.current.picks).toEqual([]);
  });
});

describe('useSmartMatch — cancel on newer query', () => {
  it('aborts the in-flight call when query changes before it resolves', async () => {
    setSession('sid-1', { ready: true });
    const firstAbort: { current: AbortSignal | null } = { current: null };
    const spy = vi.spyOn(backendTools, 'smart_match_command').mockImplementation(
      // Hold the first call open; the second call resolves immediately.
      (_sid, _input, signal) => {
        if (firstAbort.current === null) {
          firstAbort.current = signal ?? null;
          return new Promise(() => { /* never resolves */ });
        }
        return Promise.resolve({ ok: true, output: { picks: [] } });
      },
    );

    const { rerender } = renderHook(({ q }: { q: string }) => useSmartMatch(q, { enabled: true }), {
      initialProps: { q: 'foggy night' },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: RUNTIME.smartMatchDebounceMs + 200 });
    expect(firstAbort.current?.aborted).toBe(false);

    // Newer query supersedes the in-flight one.
    act(() => rerender({ q: 'foggy morning' }));
    expect(firstAbort.current?.aborted).toBe(true);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2), { timeout: RUNTIME.smartMatchDebounceMs + 200 });
  });
});
