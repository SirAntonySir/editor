import { it, expect, vi, beforeEach } from 'vitest';
import { promoteSingleBand } from './colour-band-spawn';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { proposeStack: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().clearSelection();
});

it('spawns a single-band HSL widget for the chosen band', () => {
  promoteSingleBand('s1', 'blue', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      preset_id: 'tone_blue',
      origin: 'tool_invoked',
      layerId: 'L1',
      scope: { kind: 'global' },
    }),
  );
});

it('no-ops without a session or layer', () => {
  promoteSingleBand(null, 'blue', 'L1');
  promoteSingleBand('s1', 'blue', null);
  expect(backendTools.proposeStack).not.toHaveBeenCalled();
});

it('uses global scope when no object is active', () => {
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    scope: { kind: 'global' },
  }));
});

it('uses mask scope when an object is active', () => {
  useEditorStore.setState({ activeObjectId: 'm-12' });
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    scope: { kind: 'mask', mask_id: 'm-12' },
  }));
});

it('ships layerIds derived from the active image-node', () => {
  useEditorStore.setState({
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
    },
    activeImageNodeId: 'in-1',
  });
  promoteSingleBand('S1', 'red', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    layerId: 'L1',
    layerIds: ['L1', 'L2'],
  }));
});

it('omits layerIds when no active image-node', () => {
  useEditorStore.setState({ activeImageNodeId: null });
  promoteSingleBand('S1', 'red', 'L1');
  const call = vi.mocked(backendTools.proposeStack).mock.calls.at(-1)?.[1];
  expect(call?.layerId).toBe('L1');
  expect(call?.layerIds).toBeUndefined();
});
