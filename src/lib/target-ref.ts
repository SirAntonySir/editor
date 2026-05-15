import { useEditorStore } from '@/store';
import { useGraphStore } from '@/store/graph-store';
import type { TargetRef } from '@/types/ai-target';

export function resolveSmartTarget(): TargetRef {
  const editor = useEditorStore.getState();
  const graph = useGraphStore.getState();

  const selectedId = graph.selectedNodeId ?? graph.highlightedNodeId;
  if (selectedId) {
    for (const layer of editor.layers) {
      const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === selectedId);
      if (adj) {
        return { kind: 'node', layerId: layer.id, adjustmentId: adj.id };
      }
    }
  }

  if (editor.activeLayerId) {
    return { kind: 'layer', layerId: editor.activeLayerId };
  }

  const firstImage = editor.layers.find((l) => l.type === 'image');
  if (firstImage) return { kind: 'layer', layerId: firstImage.id };

  return { kind: 'composite' };
}

export function humanLabelFor(ref: TargetRef): string {
  if (ref.kind === 'composite') return 'Whole composite';

  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === ref.layerId);
  if (!layer) return 'Unknown target';
  if (ref.kind === 'layer') return layer.name;

  if (ref.kind === 'mask') {
    return `${layer.name} · Selection`;
  }

  const adj = layer.adjustmentStack?.adjustments.find((a) => a.id === ref.adjustmentId);
  if (!adj) return 'Unknown target';
  return `${layer.name} · ${adj.name}`;
}

// ─── renderTargetSnapshot ──────────────────────────────────────────────────

const SNAPSHOT_MAX_EDGE = 768;

async function canvasToDownscaledPng(
  source: HTMLCanvasElement | OffscreenCanvas,
): Promise<Blob> {
  const w = source.width;
  const h = source.height;
  if (w === 0 || h === 0) throw new Error('renderTargetSnapshot: empty source');

  const scale = Math.min(1, SNAPSHOT_MAX_EDGE / Math.max(w, h));
  const targetW = Math.max(1, Math.round(w * scale));
  const targetH = Math.max(1, Math.round(h * scale));

  const tmp = document.createElement('canvas');
  tmp.width = targetW;
  tmp.height = targetH;
  const ctx = tmp.getContext('2d');
  if (!ctx) throw new Error('renderTargetSnapshot: 2d context unavailable');
  ctx.drawImage(source, 0, 0, targetW, targetH);

  return await new Promise<Blob>((resolve, reject) => {
    tmp.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    );
  });
}

/**
 * Returns a downscaled PNG blob of the target's current pixel state.
 * Sent ephemerally to the backend; never cached.
 *
 * Initial implementation:
 *   - composite → full document composite
 *   - layer    → that layer's pipeline output (per-layer post-adjustment pixels)
 *   - node     → the host layer's current output (TODO: precise mid-chain rendering)
 *
 * The 'node' case falls back to layer rendering until partial-pipeline rendering
 * is implemented (tracked in the spec's future-work list).
 *
 * Imports are deferred (dynamic) to avoid triggering document.createElement at
 * module-load time, which would break Node/Vitest environments.
 */
export async function renderTargetSnapshot(target: TargetRef): Promise<Blob> {
  // Lazy imports — these modules touch the DOM at construction time, so we
  // must not import them at the top of the module (breaks Vitest/Node).
  const [{ LayerCompositor }, { PipelineManager }, { pixelStore }] = await Promise.all([
    import('./layer-compositor'),
    import('./pipeline-manager'),
    import('@/core/pixel-store'),
  ]);

  if (target.kind === 'composite') {
    const composite = LayerCompositor.compositeSync();
    return canvasToDownscaledPng(composite);
  }

  if (target.kind === 'mask') {
    const editor = useEditorStore.getState();
    const layer = editor.layers.find((l) => l.id === target.layerId);
    if (!layer) throw new Error('renderTargetSnapshot: mask layer missing');
    const rendered = LayerCompositor.renderLayer(layer);
    if (!rendered) throw new Error('renderTargetSnapshot: failed to render host layer');
    return canvasToDownscaledPng(rendered);
    // TODO(Plan A Task 3): multiply by mask alpha after maskStore lands
  }

  // layer or node — render the host layer through its adjustment pipeline.
  const editor = useEditorStore.getState();
  const layer = editor.layers.find((l) => l.id === target.layerId);
  if (layer) {
    const rendered = LayerCompositor.renderLayer(layer);
    if (rendered) return canvasToDownscaledPng(rendered);
  }

  // Fallback: global pipeline output (best-effort when it's the active layer).
  // PipelineManager exposes no per-layer accessor; getOutput() returns the last rendered canvas.
  const pipelineOut = PipelineManager.getOutput();
  if (pipelineOut) return canvasToDownscaledPng(pipelineOut);

  // Final fallback: raw source pixels for that layer.
  const src = pixelStore.getSource(target.layerId);
  if (src) return canvasToDownscaledPng(src);

  throw new Error(`renderTargetSnapshot: no pixels for target ${JSON.stringify(target)}`);
}
