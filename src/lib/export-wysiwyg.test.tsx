import { it, expect, vi, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';

// The composite is WebGL/canvas — mock it out; we assert that export drives the
// SAME on-screen renderer (renderImageNodeComposite) with WYSIWYG args, rather
// than the legacy LayerCompositor path that dropped geometry + adjustments.
vi.mock('./image-node-renderer', () => ({ renderImageNodeComposite: vi.fn() }));
import { renderImageNodeComposite } from './image-node-renderer';
import { renderImageNodeToCanvas } from './export';

function addImageLayer(id: string) {
  useEditorStore.getState().addLayer({
    id, type: 'image', name: id, visible: true, opacity: 1, blendMode: 'normal', locked: false,
  });
}

function setSnapshot(nodes: unknown[]) {
  useBackendState.setState({
    snapshot: { operationGraph: { nodes }, widgets: [] },
    optimistic: new Map(),
  } as never);
}

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ layers: [] });
  vi.mocked(renderImageNodeComposite).mockReset();
});

it('renders the export through the on-screen renderer at full res with overlays off', () => {
  addImageLayer('l1');
  const nodeId = useEditorStore.getState().addImageNode(['l1'], { x: 0, y: 0 }, { w: 100, h: 80 });
  setSnapshot([]); // no transforms → effective size == source

  const canvas = renderImageNodeToCanvas(nodeId);

  expect(canvas).not.toBeNull();
  expect(renderImageNodeComposite).toHaveBeenCalledTimes(1);
  const args = vi.mocked(renderImageNodeComposite).mock.calls[0][0];
  expect(args.skipOverlays).toBe(true);
  expect(args.renderScale).toBe(1);
  expect(args.layerIds).toEqual(['l1']);
  // No crop/rotate → canvas matches source dims.
  expect(args.canvas.width).toBe(100);
  expect(args.canvas.height).toBe(80);
});

it('sizes the export canvas to the crop rect so geometry is baked', () => {
  addImageLayer('l1');
  const nodeId = useEditorStore.getState().addImageNode(['l1'], { x: 0, y: 0 }, { w: 100, h: 80 });
  setSnapshot([
    {
      id: `transform:${nodeId}:crop`,
      type: 'crop',
      scope: { kind: 'global' },
      params: { x: 10, y: 10, w: 40, h: 30 },
      inputs: [],
    },
  ]);

  renderImageNodeToCanvas(nodeId);

  const args = vi.mocked(renderImageNodeComposite).mock.calls[0][0];
  // Cropped output, NOT the 100×80 source — proves the export honours geometry.
  expect(args.canvas.width).toBe(40);
  expect(args.canvas.height).toBe(30);
});

it('returns null for an unknown image node', () => {
  setSnapshot([]);
  expect(renderImageNodeToCanvas('does-not-exist')).toBeNull();
  expect(renderImageNodeComposite).not.toHaveBeenCalled();
});
