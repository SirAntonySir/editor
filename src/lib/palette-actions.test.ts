import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proposeFromPalette } from './palette-actions';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } }),
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
  it('no-ops when no session or no layer', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await proposeFromPalette('warmer');
    expect(backendTools.propose_widget).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[palette] no session or layer, ignoring submit');
    warnSpy.mockRestore();
  });

  it('calls propose_widget with intent + scope + prompt + layer_id + origin when session + layer are set', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    await proposeFromPalette('warmer');
    expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
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
    expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
      intent: 'warmer',
      scope: { kind: 'named_region', label: 'sky' },
      prompt: 'warmer',
      layer_id: LAYER_ID,
      origin: 'mcp_user_prompt',
    });
  });

  it('logs error when propose_widget returns ok:false', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    vi.mocked(backendTools.propose_widget).mockResolvedValueOnce({ ok: false, error: { code: 'BAD', message: 'nope' } } as never);
    useBackendState.setState({ sessionId: 's1' });
    seedLayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await proposeFromPalette('warmer');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
