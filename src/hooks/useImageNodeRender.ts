/**
 * useImageNodeRender — React glue around `renderImageNodeComposite`.
 *
 * The hook owns a canvas ref and re-paints whenever its inputs (layer ids,
 * size, backend snapshot) change. Pure-function rendering lives in
 * `image-node-renderer.ts` so it stays test-friendly.
 */

import { useEffect, useRef } from 'react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { renderImageNodeComposite } from '@/lib/image-node-renderer';
import type { Widget } from '@/types/widget';

const EMPTY_WIDGETS: Widget[] = [];

export interface ImageNodeRenderInput {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function useImageNodeRender({
  imageNodeId,
  layerIds,
  width,
  height,
}: ImageNodeRenderInput) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const opGraph = useBackendState((s) => s.snapshot?.operation_graph);
  const widgets = useBackendState((s) => s.snapshot?.widgets ?? EMPTY_WIDGETS);
  // Re-render when adjustment params or raw pixels change.
  const optimisticSize = useBackendState((s) => s.optimistic.size);
  const pixelVersion = useEditorStore((s) => s.pixelVersion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    renderImageNodeComposite({
      canvas,
      imageNodeId,
      layerIds,
      opGraph,
      widgets,
    });
  }, [imageNodeId, layerIds, width, height, opGraph, widgets, optimisticSize, pixelVersion]);

  return { canvasRef };
}
