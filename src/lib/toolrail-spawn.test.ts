import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { spawnToolWidget } from './toolrail-spawn';
import { CanvasToolRegistry } from '@/lib/canvas-tool-registry';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { usePreferencesStore } from '@/store/preferences-store';
import { LightTool } from '@/tools/light-tool';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } }),
  },
}));

beforeEach(() => {
  CanvasToolRegistry.register(LightTool);
  useEditorStore.getState().clearSelection();
  useEditorStore.getState().resetWorkspace();
  useBackendState.getState().reset();
  usePreferencesStore.setState({ useWorkspaceCanvas: false });
  vi.clearAllMocks();
});

describe('spawnToolWidget', () => {
  it('falls through to cursor-bind on the Fabric branch', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    usePreferencesStore.setState({ useWorkspaceCanvas: false });

    expect(spawnToolWidget('light')).toBe(true);
    expect(useEditorStore.getState().pendingBind).toEqual({ kind: 'tool', toolName: 'light' });
    expect(backendTools.propose_widget).not.toHaveBeenCalled();
  });

  it('returns false for tools without a processingId', () => {
    expect(spawnToolWidget('unknown-tool')).toBe(false);
  });

  it('workspace mode + no activeImageNodeId → toast, no propose_widget', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    usePreferencesStore.setState({ useWorkspaceCanvas: true });
    useBackendState.setState({ sessionId: 's1' });

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.propose_widget).not.toHaveBeenCalled();
    // Pending bind must NOT be set in workspace mode.
    expect(useEditorStore.getState().pendingBind).toBeNull();
  });

  it('workspace mode + active node → direct propose_widget with the node\'s layer', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    usePreferencesStore.setState({ useWorkspaceCanvas: true });
    useBackendState.setState({ sessionId: 's1' });

    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.propose_widget).toHaveBeenCalledWith('s1', {
      intent: 'Light',
      scope: { kind: 'global' },
      fused_tool_id: 'light',
      layer_id: 'layer-a',
      origin: 'tool_invoked',
    });
  });

  it('workspace mode without a backend session does nothing observable', async () => {
    const { backendTools } = await import('@/lib/backend-tools');
    usePreferencesStore.setState({ useWorkspaceCanvas: true });

    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    expect(spawnToolWidget('light')).toBe(true);
    expect(backendTools.propose_widget).not.toHaveBeenCalled();
  });
});
