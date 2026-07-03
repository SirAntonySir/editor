import { describe, it, expect, beforeEach, vi } from 'vitest';
import { spawnGenfillFromMask } from './genfill-spawn';
import { useBackendState } from '@/store/backend-state-slice';
import { useAiSession } from '@/hooks/useImageContext';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    genfill_create: vi.fn(async () => ({ ok: true, output: { widgetId: 'w_gf_1' } })),
    propose_mask: vi.fn(async () => ({ ok: true, output: { maskId: 'm_new' } })),
  },
}));

vi.mock('@/components/ui/Toast', () => ({ toast: { info: vi.fn() } }));

describe('spawnGenfillFromMask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Canonical session id lives on useBackendState (set on connection);
    // useAiSession.sessionId is only populated after AI analysis runs.
    useBackendState.getState().reset();
    useBackendState.getState().setSessionId('s1');
    useBackendState.getState().setSseStatus('open');
    useAiSession.setState({ sessionId: null });
  });

  it('uses the backend session id even when AI analysis has not run', async () => {
    // Regression: requireSession() previously read only useAiSession.sessionId,
    // which stays null until analysis — genfill wrongly showed "session not ready".
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBe('w_gf_1');
    expect(backendTools.genfill_create).toHaveBeenCalledWith('s1', expect.objectContaining({ maskId: 'm1' }));
  });

  it('calls genfill_create with the mask and empty prompt (compose)', async () => {
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBe('w_gf_1');
    expect(backendTools.genfill_create).toHaveBeenCalledWith('s1', {
      imageNodeId: 'in-default',
      maskId: 'm1',
      prompt: '',
      origin: 'tool_invoked',
    });
  });

  it('passes prompt + origin through when provided', async () => {
    await spawnGenfillFromMask('m1', 'in-default', 'a red boat', 'mcp_user_prompt');
    expect(backendTools.genfill_create).toHaveBeenCalledWith('s1', {
      imageNodeId: 'in-default',
      maskId: 'm1',
      prompt: 'a red boat',
      origin: 'mcp_user_prompt',
    });
  });

  it('refuses when SSE is not open', async () => {
    useBackendState.getState().setSseStatus('closed');
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBeNull();
    expect(backendTools.genfill_create).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    useBackendState.getState().setSessionId(null);
    useAiSession.setState({ sessionId: null });
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBeNull();
    expect(backendTools.genfill_create).not.toHaveBeenCalled();
  });

  it('returns null and surfaces a toast on backend failure', async () => {
    vi.mocked(backendTools.genfill_create).mockResolvedValueOnce({
      ok: false, error: { code: 'x', message: 'boom', retryable: false },
    } as never);
    const id = await spawnGenfillFromMask('m1', 'in-default');
    expect(id).toBeNull();
  });
});
