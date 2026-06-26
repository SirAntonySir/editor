import { describe, expect, it, vi, afterEach } from 'vitest';
import { backendTools } from './backend-tools';

afterEach(() => vi.unstubAllGlobals());

describe('backendTools.postToolResult', () => {
  it('POSTs the result to /tool_result with snake_case body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ resolved: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await backendTools.postToolResult('sid-1', {
      requestId: 'req-1', ok: true, output: { imageNodeId: 'in-3' },
    });

    expect(out).toEqual({ resolved: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/state/sid-1/tool_result');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.request_id).toBe('req-1');
    expect(body.ok).toBe(true);
    expect(body.output).toEqual({ imageNodeId: 'in-3' });
  });
});
