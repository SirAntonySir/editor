import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { proposeFromPalette } from './palette-actions';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    proposeStack: vi.fn().mockResolvedValue({ ok: true, output: { widgets: [] } }),
  },
}));

beforeEach(() => {
  useBackendState.getState().reset();
  useEditorStore.getState().revertAll();
  vi.clearAllMocks();
});

const LAYER_ID = 'layer-1';

function seedLayer() {
  useEditorStore.getState().addLayer({
    id: LAYER_ID, type: 'image', name: 'Test', visible: true,
    opacity: 1, blendMode: 'normal', locked: false,
  });
}

describe('proposeFromPalette', () => {
  it('returns a structured error when no session or no layer', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    const result = await proposeFromPalette('warmer');
    expect(backendTools.proposeStack).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no_session');
  });

  it('calls proposeStack with intent + scope + prompt + layer_id + origin when session + layer are set', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    await proposeFromPalette('warmer');
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
      intent: 'warmer',
      scope: { kind: 'global' },
      prompt: 'warmer',
      layer_id: LAYER_ID,
      origin: 'mcp_user_prompt',
    });
  });

  it('honors a custom scope', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    await proposeFromPalette('warmer', { kind: 'named_region', label: 'sky' });
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
      intent: 'warmer',
      scope: { kind: 'named_region', label: 'sky' },
      prompt: 'warmer',
      layer_id: LAYER_ID,
      origin: 'mcp_user_prompt',
    });
  });

  it('returns a structured error when proposeStack returns ok:false', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    vi.mocked(backendTools.proposeStack).mockResolvedValueOnce({ ok: false, error: { code: 'BAD', message: 'nope', retryable: true, recovery_hint: 'try again' } } as never);
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    const result = await proposeFromPalette('warmer');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('BAD');
      expect(result.error.message).toBe('nope');
      expect(result.error.recovery_hint).toBe('try again');
    }
  });

  it('returns ok:true on success', async () => {
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    const result = await proposeFromPalette('warmer');
    expect(result.ok).toBe(true);
  });
});
