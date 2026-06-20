import { it, expect, vi, beforeEach } from 'vitest';
import { promoteToCanvas } from './promote';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { proposeStack: vi.fn().mockResolvedValue({ ok: true }) } }));

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().clearSelection();
});

it('builds the tool_invoked proposeStack call', () => {
  promoteToCanvas('s1', 'light', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
    intent: 'light', scope: { kind: 'global' }, forced_ops: ['light'], layerId: 'L1', origin: 'tool_invoked',
  });
});

it('no-ops with no session or no layer', () => {
  promoteToCanvas(null, 'light', 'L1');
  promoteToCanvas('s1', 'light', null);
  expect(backendTools.proposeStack).not.toHaveBeenCalled();
});

it('promoteToCanvas uses activeObjectId for scope when set', () => {
  useEditorStore.setState({ activeObjectId: 'mask-42' });
  promoteToCanvas('S1', 'curves', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', {
    intent: 'curves', scope: { kind: 'mask', mask_id: 'mask-42' }, forced_ops: ['curves'], layerId: 'L1', origin: 'tool_invoked',
  });
});

it('ships layerIds derived from the active image-node', () => {
  useEditorStore.setState({
    imageNodes: {
      'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
    },
    activeImageNodeId: 'in-1',
  });
  promoteToCanvas('S1', 'curves', 'L1');
  expect(backendTools.proposeStack).toHaveBeenCalledWith('S1', expect.objectContaining({
    layerId: 'L1',
    layerIds: ['L1', 'L2'],
  }));
});

it('omits layerIds when no active image-node', () => {
  useEditorStore.setState({ activeImageNodeId: null });
  promoteToCanvas('S1', 'curves', 'L1');
  const call = vi.mocked(backendTools.proposeStack).mock.calls.at(-1)?.[1];
  expect(call?.layerId).toBe('L1');
  expect(call?.layerIds).toBeUndefined();
});
