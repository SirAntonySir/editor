/**
 * Tests for frameThrottle — the render-loop coalescer. Contract:
 *  - LEADING edge: the first schedule in an idle window runs synchronously
 *    (drag feedback starts instantly; existing sync tests stay valid)
 *  - storm: further schedules inside the same frame window collapse into ONE
 *    trailing run on the next animation frame, executing the LATEST body
 *  - cancel drops any pending trailing run
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { frameThrottle } from './frame-throttle';

// Manual rAF: callbacks queue until flushFrame() is called.
let rafQueue: FrameRequestCallback[] = [];
function flushFrame() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}

beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('frameThrottle', () => {
  it('runs the first schedule synchronously (leading edge)', () => {
    const runs: string[] = [];
    const t = frameThrottle();
    t.schedule(() => runs.push('a'));
    expect(runs).toEqual(['a']);
  });

  it('collapses a same-frame storm into one trailing run with the LATEST body', () => {
    const runs: string[] = [];
    const t = frameThrottle();
    t.schedule(() => runs.push('move-1')); // leading — sync
    t.schedule(() => runs.push('move-2')); // storm — deferred
    t.schedule(() => runs.push('move-3')); // storm — replaces move-2
    expect(runs).toEqual(['move-1']);

    flushFrame();
    expect(runs).toEqual(['move-1', 'move-3']); // one trailing run, latest wins
  });

  it('re-opens the window after the trailing run (next storm coalesces again)', () => {
    const runs: string[] = [];
    const t = frameThrottle();
    t.schedule(() => runs.push('1'));
    t.schedule(() => runs.push('2'));
    flushFrame(); // trailing '2' + window re-armed
    t.schedule(() => runs.push('3')); // still inside the re-armed window → deferred
    flushFrame();
    expect(runs).toEqual(['1', '2', '3']);
  });

  it('runs synchronously again once the window closes with no trailing work', () => {
    const runs: string[] = [];
    const t = frameThrottle();
    t.schedule(() => runs.push('1'));
    flushFrame(); // window closes, nothing trailing
    t.schedule(() => runs.push('2'));
    expect(runs).toEqual(['1', '2']); // leading again — no frame wait
  });

  it('cancel drops the pending trailing run', () => {
    const runs: string[] = [];
    const t = frameThrottle();
    t.schedule(() => runs.push('1'));
    t.schedule(() => runs.push('2'));
    t.cancel();
    flushFrame();
    expect(runs).toEqual(['1']);
  });
});
