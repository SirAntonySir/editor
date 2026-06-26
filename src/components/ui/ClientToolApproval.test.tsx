import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { postToolResult: vi.fn(async () => ({ resolved: true })) },
}));
vi.mock('@/lib/tool-manifest/llm-tool-registry', () => ({
  LlmToolRegistry: { invoke: vi.fn(async () => ({ image_node_id: 'in-3' })) },
}));
vi.mock('@/lib/ai-access', () => ({ useAiAccess: () => true }));

const { backendTools } = await import('@/lib/backend-tools');
const { LlmToolRegistry } = await import('@/lib/tool-manifest/llm-tool-registry');
const { useClientToolApproval } = await import('@/store/client-tool-approval-slice');
const { useBackendState } = await import('@/store/backend-state-slice');
const { ClientToolApproval } = await import('./ClientToolApproval');

beforeEach(() => {
  vi.clearAllMocks();
  useClientToolApproval.getState().reset();
  useBackendState.getState().setSessionId('sid-1');
});

describe('ClientToolApproval', () => {
  it('Allow runs the tool and posts ok, then dequeues', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r1', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /allow/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).toHaveBeenCalledWith('extract_object_to_image_node', { maskId: 'm1' });
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r1', ok: true, output: { image_node_id: 'in-3' } });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });

  it('Deny posts denied without running the tool', async () => {
    useClientToolApproval.getState().enqueue({ requestId: 'r2', name: 'convert_object_to_layer_mask', input: { maskId: 'm2' } });
    render(<ClientToolApproval />);
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    await waitFor(() => {
      expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
      expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', { requestId: 'r2', ok: false, denied: true });
      expect(useClientToolApproval.getState().pending).toEqual([]);
    });
  });
});
