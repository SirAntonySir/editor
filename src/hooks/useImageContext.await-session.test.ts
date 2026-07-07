/**
 * Unit tests for useAiSession.awaitSession — the readiness gate that lets
 * callers running BEFORE openSession finishes (e.g. addImage during a
 * multi-file drop) persist/upload under the session that is still bootstrapping.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { useAiSession } from './useImageContext';

describe('useAiSession.awaitSession', () => {
  afterEach(() => {
    useAiSession.getState().reset();
  });

  it('returns the id immediately when a session is already open', async () => {
    useAiSession.setState({ sessionId: 'sid-open', status: 'idle' });
    await expect(useAiSession.getState().awaitSession()).resolves.toBe('sid-open');
  });

  it('resolves null at once when no bootstrap is in flight', async () => {
    useAiSession.setState({ sessionId: null, status: 'idle' });
    await expect(useAiSession.getState().awaitSession()).resolves.toBeNull();
  });

  it('resolves the id when an in-flight bootstrap lands', async () => {
    useAiSession.setState({ sessionId: null, status: 'uploading' });
    const p = useAiSession.getState().awaitSession();
    // Bootstrap completes on a later tick.
    await Promise.resolve();
    useAiSession.setState({ sessionId: 'sid-late', status: 'idle' });
    await expect(p).resolves.toBe('sid-late');
  });

  it('resolves null (does not hang) when an in-flight bootstrap fails', async () => {
    useAiSession.setState({ sessionId: null, status: 'uploading' });
    const p = useAiSession.getState().awaitSession();
    await Promise.resolve();
    useAiSession.setState({ sessionId: null, status: 'error', error: 'boom' });
    await expect(p).resolves.toBeNull();
  });
});
