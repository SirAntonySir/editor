import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { postToolResult: vi.fn(async () => ({ resolved: true })) },
}));
vi.mock('@/lib/tool-manifest/llm-tool-registry', () => ({
  LlmToolRegistry: {
    invoke: vi.fn(async () => ['sky']),
    getKind: vi.fn((name: string) => (name === 'list_objects' ? 'query' : 'mutate')),
  },
}));

const { backendTools } = await import('@/lib/backend-tools');
const { LlmToolRegistry } = await import('@/lib/tool-manifest/llm-tool-registry');
const { runClientTool, useBackendState } = await import('./backend-state-slice');
const { useClientToolApproval } = await import('./client-tool-approval-slice');

beforeEach(() => {
  vi.clearAllMocks();
  useClientToolApproval.getState().reset();
  useBackendState.getState().setSessionId('sid-1');
});

describe('runClientTool', () => {
  it('auto-runs a query tool (kind from registry) and posts the result', async () => {
    await runClientTool({ requestId: 'r1', name: 'list_objects', input: {} });
    expect(LlmToolRegistry.invoke).toHaveBeenCalledWith('list_objects', {});
    expect(backendTools.postToolResult).toHaveBeenCalledWith('sid-1', {
      requestId: 'r1', ok: true, output: ['sky'],
    });
    expect(useClientToolApproval.getState().pending).toEqual([]);
  });

  it('enqueues a mutate tool for approval and does NOT auto-run', async () => {
    await runClientTool({ requestId: 'r2', name: 'extract_object_to_image_node', input: { maskId: 'm1' } });
    expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
    expect(backendTools.postToolResult).not.toHaveBeenCalled();
    expect(useClientToolApproval.getState().pending).toEqual([
      { requestId: 'r2', name: 'extract_object_to_image_node', input: { maskId: 'm1' } },
    ]);
  });

  it('treats an unknown tool as mutate (fails safe → approval, no auto-run)', async () => {
    (LlmToolRegistry.getKind as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    await runClientTool({ requestId: 'r3', name: 'mystery_tool', input: {} });
    expect(LlmToolRegistry.invoke).not.toHaveBeenCalled();
    expect(useClientToolApproval.getState().pending.map((p) => p.requestId)).toEqual(['r3']);
  });
});
