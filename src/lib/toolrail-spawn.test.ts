import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { spawnToolWidget } from './toolrail-spawn';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { ToolDefinition } from '@/types/tool';

// Minimal stub for the light tool (replaces deleted light-tool.tsx).
const LightToolStub: ToolDefinition = {
  name: 'light',
  label: 'Light',
  icon: () => null,
  category: 'adjust',
  processingId: 'light',
  onActivate: () => {},
};

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    proposeStack: vi.fn().mockResolvedValue({ ok: true, output: { widgets: [] } }),
  },
}));

beforeEach(() => {
  CanvasToolRegistry.register(LightToolStub);
  useEditorStore.getState().clearSelection();
  useEditorStore.getState().resetWorkspace();
  useBackendState.getState().reset();
  vi.clearAllMocks();
});

describe('spawnToolWidget', () => {
  it('returns false for tools without a processingId', () => {
    expect(spawnToolWidget('unknown-tool')).toBe(false);
  });

  it('no activeImageNodeId → toast, no proposeStack', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.proposeStack).not.toHaveBeenCalled();
  });

  it('active node → proposeStack with forced_ops and global scope', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });

    const nodeId = useEditorStore.getState().addImageNode(['layer-a', 'layer-b'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
      intent: 'Light',
      scope: { kind: 'global' },
      forced_ops: ['light'],
      layerId: 'layer-a',
      origin: 'tool_invoked',
    });
  });

  it('active mask scope wins — user-selected scope is preserved', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    useBackendState.setState({ sessionId: 's1' });

    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);
    useEditorStore.getState().setActiveObjectId('m1');

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.proposeStack).toHaveBeenCalledWith('s1', {
      intent: 'Light',
      scope: { kind: 'mask', mask_id: 'm1' },
      forced_ops: ['light'],
      layerId: 'layer-a',
      origin: 'tool_invoked',
    });
  });

  it('no backend session does nothing observable', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.proposeStack).not.toHaveBeenCalled();
  });
});
