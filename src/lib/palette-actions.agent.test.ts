import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tool-manifest/serialize', () => ({
  serializeForAgentLoop: vi.fn((names: string[]) =>
    names.map((n) => ({ name: n, description: '', input_schema: {} })),
  ),
}));

// Control which mask ids "exist" without registering real pixel-backed masks.
const maskHasSet = new Set<string>();
vi.mock('@/core/mask-store', () => ({
  maskStore: {
    has: (id: string) => maskHasSet.has(id),
    get: (id: string) => ({ label: id }),
  },
}));

// Stub the actual store/registry mutation — we assert it's *called*, not its
// pixel side effects (those are covered in object-actions.test.ts).
const extractMock = vi.fn();
const extractLayerMock = vi.fn();
vi.mock('@/lib/segmentation/object-actions', () => ({
  extractObjectToImageNode: (...a: unknown[]) => extractMock(...a),
  extractObjectToLayer: (...a: unknown[]) => extractLayerMock(...a),
}));

// Default region-extraction choice for tests that attach a committed-mask chip;
// individual tests override by passing a getChoice to runAgentTurn.
const chooseNode = async () => 'node' as const;

const { useBackendState } = await import('@/store/backend-state-slice');
const { runAgentTurn, AGENT_LOOP_TOOLS } = await import('./palette-actions.agent');

beforeEach(() => {
  useBackendState.getState().setSessionId('sid-1');
  maskHasSet.clear();
  extractMock.mockReset();
  extractLayerMock.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, tool_calls: 2 }), { status: 200 })));
});

function lastBody() {
  const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
  return JSON.parse((init as RequestInit).body as string);
}

describe('runAgentTurn', () => {
  it('passes unresolvable chips through as attached_objects', async () => {
    const out = await runAgentTurn('make the sky dramatic', ['region:object:mask_sky']);
    expect(out).toEqual({ ok: true, toolCalls: 2 });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/state/sid-1/agent_turn');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.intent).toBe('make the sky dramatic');
    expect(body.attached_objects).toEqual(['mask_sky']);
    expect(body.forced_targets).toEqual([]);
    expect(extractMock).not.toHaveBeenCalled();
    expect(body.client_tools.map((t: { name: string }) => t.name)).toEqual(AGENT_LOOP_TOOLS);
  });

  it('includes the active node id + layer ids', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    await runAgentTurn('x', []);
    const body = lastBody();
    expect(body.active_node).toEqual({ image_node_id: nodeId, layer_ids: ['l-1', 'l-2'] });
  });

  it('routes an @-picked image-node target straight to forced_targets', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['lt-a', 'lt-b']);
    await runAgentTurn('brighten it', [`target:node:${nodeId}`]);
    const body = lastBody();
    expect(body.forced_targets).toEqual([{ image_node_id: nodeId, layer_ids: ['lt-a', 'lt-b'] }]);
    expect(body.attached_objects).toEqual([]);
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('resolves an @-picked layer target to its owning node + that one layer', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['lt-solo']);
    await runAgentTurn('x', ['target:layer:lt-solo']);
    const body = lastBody();
    expect(body.forced_targets).toEqual([{ image_node_id: nodeId, layer_ids: ['lt-solo'] }]);
  });

  it('dedupes a node chip + one of its layer chips into a single forced_target', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['ld-1', 'ld-2']);
    await runAgentTurn('x', [`target:node:${nodeId}`, 'target:layer:ld-1']);
    const body = lastBody();
    expect(body.forced_targets).toEqual([{ image_node_id: nodeId, layer_ids: ['ld-1', 'ld-2'] }]);
  });

  it('extracts a committed object chip to an image node when the user chooses "node"', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    maskHasSet.add('m1');
    extractMock.mockReturnValue({ imageNodeId: 'node-new', layerId: 'L1' });
    await runAgentTurn('make it pop', ['region:object:m1'], chooseNode);
    expect(extractMock).toHaveBeenCalledWith('m1', nodeId);
    const body = lastBody();
    expect(body.forced_targets).toEqual([{ image_node_id: 'node-new', layer_ids: ['L1'] }]);
    expect(body.attached_objects).toEqual([]);
  });

  it('extracts a committed object chip to a LAYER when the user chooses "layer"', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    maskHasSet.add('m1');
    extractLayerMock.mockReturnValue('layer-new');
    await runAgentTurn('make it pop', ['region:object:m1'], async () => 'layer');
    expect(extractLayerMock).toHaveBeenCalledWith('m1', nodeId);
    expect(extractMock).not.toHaveBeenCalled();
    const body = lastBody();
    // Layer extraction targets the SAME node + the new layer.
    expect(body.forced_targets).toEqual([{ image_node_id: nodeId, layer_ids: ['layer-new'] }]);
  });

  it('drops a region entirely when the user denies it (no extract, no fallback)', async () => {
    const { useEditorStore } = await import('@/store');
    const nodeId = useEditorStore.getState().addImageNode(['l-1']);
    useEditorStore.getState().setActiveImageNode(nodeId);
    maskHasSet.add('m1');
    await runAgentTurn('make it pop', ['region:object:m1'], async () => 'deny');
    expect(extractMock).not.toHaveBeenCalled();
    expect(extractLayerMock).not.toHaveBeenCalled();
    const body = lastBody();
    expect(body.forced_targets).toEqual([]);
    expect(body.attached_objects).toEqual([]);
  });
});
