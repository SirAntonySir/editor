import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tool-manifest/serialize', () => ({
  serializeForAgentLoop: vi.fn((names: string[]) =>
    names.map((n) => ({ name: n, description: '', input_schema: {} })),
  ),
}));

const { useBackendState } = await import('@/store/backend-state-slice');
const { runAgentTurn, AGENT_LOOP_TOOLS } = await import('./palette-actions.agent');

beforeEach(() => {
  useBackendState.getState().setSessionId('sid-1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, tool_calls: 2 }), { status: 200 })));
});

describe('runAgentTurn', () => {
  it('POSTs intent + attached_objects + serialized client_tools', async () => {
    const out = await runAgentTurn('make the sky dramatic', ['mask_sky']);
    expect(out).toEqual({ ok: true, toolCalls: 2 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/state/sid-1/agent_turn');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.intent).toBe('make the sky dramatic');
    expect(body.attached_objects).toEqual(['mask_sky']);
    expect(body.client_tools.map((t: { name: string }) => t.name)).toEqual(AGENT_LOOP_TOOLS);
  });
});
