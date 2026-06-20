import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { listObjectsTool } from './list-objects';

beforeEach(() => {
  maskStore.clear();
  objectOwnership._resetForTests();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ activeImageNodeId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('list_objects handler', () => {
  it('returns empty list when no masks are registered', () => {
    const result = listObjectsTool.handler({});
    expect(result.objects).toHaveLength(0);
  });

  it('returns all objects when no imageNodeId filter is given and no active node', () => {
    const id1 = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    const id2 = maskStore.register({
      layerId: 'L2', label: 'Subject',
      width: 5, height: 5,
      data: new Uint8Array(25), source: 'sam-box', createdAt: 0,
    });
    objectOwnership.set(id1, 'node-A');
    objectOwnership.set(id2, 'node-B');

    const result = listObjectsTool.handler({});
    expect(result.objects).toHaveLength(2);
    const ids = result.objects.map((o) => o.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it('filters by explicit imageNodeId', () => {
    const id1 = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    const id2 = maskStore.register({
      layerId: 'L2', label: 'Subject',
      width: 5, height: 5,
      data: new Uint8Array(25), source: 'sam-box', createdAt: 0,
    });
    objectOwnership.set(id1, 'node-A');
    objectOwnership.set(id2, 'node-B');

    const result = listObjectsTool.handler({ imageNodeId: 'node-A' });
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toBe(id1);
    expect(result.objects[0].label).toBe('Sky');
    expect(result.objects[0].imageNodeId).toBe('node-A');
  });

  it('defaults to activeImageNodeId when no imageNodeId is supplied', () => {
    useEditorStore.setState({ activeImageNodeId: 'node-A' } as unknown as Parameters<typeof useEditorStore.setState>[0]);

    const id1 = maskStore.register({
      layerId: 'L1', label: 'Sky',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    const id2 = maskStore.register({
      layerId: 'L2', label: 'Subject',
      width: 5, height: 5,
      data: new Uint8Array(25), source: 'sam-box', createdAt: 0,
    });
    objectOwnership.set(id1, 'node-A');
    objectOwnership.set(id2, 'node-B');

    const result = listObjectsTool.handler({});
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toBe(id1);
  });

  it('includes width and height from the mask', () => {
    const id1 = maskStore.register({
      layerId: 'L1',
      width: 320, height: 240,
      data: new Uint8Array(320 * 240), source: 'brush', createdAt: 0,
    });
    objectOwnership.set(id1, 'node-A');

    const result = listObjectsTool.handler({ imageNodeId: 'node-A' });
    expect(result.objects[0].width).toBe(320);
    expect(result.objects[0].height).toBe(240);
  });
});
