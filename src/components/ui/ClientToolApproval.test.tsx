import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { postToolResult: vi.fn(async () => ({ resolved: true })) },
}));
vi.mock('@/lib/tool-manifest/llm-tool-registry', () => ({
  LlmToolRegistry: { invoke: vi.fn(async () => ({ image_node_id: 'in-3' })) },
}));
vi.mock('@/lib/ai-access', () => ({ useAiAccess: () => true }));
vi.mock('@/lib/segmentation/object-actions', () => ({
  extractObjectToLayer: vi.fn(() => 'new-layer'),
}));

const { backendTools } = await import('@/lib/backend-tools');
const { LlmToolRegistry } = await import('@/lib/tool-manifest/llm-tool-registry');
const { extractObjectToLayer } = await import('@/lib/segmentation/object-actions');
const { useClientToolApproval } = await import('@/store/client-tool-approval-slice');
const { useBackendState } = await import('@/store/backend-state-slice');
const { ClientToolApproval } = await import('./ClientToolApproval');

beforeEach(() => {
  vi.clearAllMocks();
  useClientToolApproval.getState().reset();
  useBackendState.getState().setSessionId('sid-1');
});

describe('ClientToolApproval', () => {
  it('extract → "Node" runs the tool and posts ok, then dequeues', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r1', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /new image node/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).toHaveBeenCalledWith('extract_object_to_image_node', { maskId: 'm1' });
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r1', ok: true, output: { image_node_id: 'in-3' } });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });

  it('extract → "Layer" runs extractObjectToLayer and posts a node+layer target', async () => {
    useClientToolApproval.getState().enqueue({
      requestId: 'r1b', name: 'extract_object_to_image_node', input: { maskId: 'm1', imageNodeId: 'in-src' },
    });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /new layer/i }));
    await waitFor(() => {
      expect(extractObjectToLayer).toHaveBeenCalledWith('m1', 'in-src');
      expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', {
        requestId: 'r1b', ok: true, output: { ok: true, image_node_id: 'in-src', layer_ids: ['new-layer'] },
      });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });

  it('Deny posts denied without running the tool', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r2', name: 'select_object', input: { maskId: 'm2' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r2', ok: false, denied: true });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });
});
