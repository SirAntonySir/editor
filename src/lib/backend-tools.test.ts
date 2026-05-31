import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { backendTools } from './backend-tools';

let lastBody: { session_id: string; input: Record<string, unknown> } | null = null;

beforeEach(() => {
  lastBody = null;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, output: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('analyze_image forwards the supplied layer_id in the request input', async () => {
  await backendTools.analyze_image('sess-1', { layer_id: 'layer-abc' });
  expect(lastBody?.input).toEqual({ layer_id: 'layer-abc' });
});

test('analyze_image omits layer_id when not supplied', async () => {
  await backendTools.analyze_image('sess-1');
  expect(lastBody?.input).toEqual({});
});
