/**
 * Leading + trailing per-frame throttle for render work.
 *
 * The image-node composite re-runs on every optimistic param patch — during a
 * drag that's one FULL WebGL pass per pointermove, and a 120 Hz mouse delivers
 * moves faster than the display can show them (the curves widget was the worst
 * case: per move it also rebuilt four 256-sample spline LUTs). This throttle
 * caps the work at display rate without adding latency:
 *
 *  - LEADING: the first `schedule` in an idle window runs its body
 *    synchronously — drag feedback still starts on the very first move.
 *  - STORM: further `schedule`s inside the open frame window are coalesced
 *    into ONE trailing run on the next animation frame, executing the LATEST
 *    body (a full repaint is idempotent; intermediate frames are dead work).
 *  - The window re-arms after a trailing run, so a sustained drag settles
 *    into exactly one composite per display frame.
 */
export interface FrameThrottle {
  /** Run `body` now (leading) or coalesce it into the next frame (storm). */
  schedule(body: () => void): void;
  /** Drop any pending trailing run (unmount cleanup). */
  cancel(): void;
}

export function frameThrottle(): FrameThrottle {
  let raf: number | null = null;
  let trailing: (() => void) | null = null;

  const openWindow = (): void => {
    raf = requestAnimationFrame(() => {
      raf = null;
      const body = trailing;
      trailing = null;
      if (body) {
        body();
        openWindow(); // re-arm so a sustained storm stays at frame rate
      }
    });
  };

  return {
    schedule(body: () => void): void {
      if (raf === null) {
        body();
        openWindow();
      } else {
        trailing = body; // latest wins
      }
    },
    cancel(): void {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      trailing = null;
    },
  };
}
