import { useImageNodeRender } from '@/hooks/useImageNodeRender';
import { useBackendState } from '@/store/backend-state-slice';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

interface RotateParams {
  angle: number;
  flip_h: boolean;
  flip_v: boolean;
}

interface CropParams {
  x: number;
  y: number;
  w: number;
  h: number;
}

function useRotateParams(imageNodeId: string): RotateParams | null {
  return useBackendState((s) => {
    const nodes = s.snapshot?.operation_graph.nodes ?? [];
    const node = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
    return node ? (node.params as unknown as RotateParams) : null;
  });
}

function useCropParams(imageNodeId: string): CropParams | null {
  return useBackendState((s) => {
    const nodes = s.snapshot?.operation_graph.nodes ?? [];
    const node = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
    return node ? (node.params as unknown as CropParams) : null;
  });
}

export function ImageNodeBody({ imageNodeId, layerIds, width, height }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height });
  const rotate = useRotateParams(imageNodeId);
  const crop = useCropParams(imageNodeId);

  const cssTransform = (() => {
    const parts: string[] = [];
    if (rotate) {
      if (rotate.flip_h) parts.push('scaleX(-1)');
      if (rotate.flip_v) parts.push('scaleY(-1)');
      parts.push(`rotate(${rotate.angle}deg)`);
    }
    return parts.join(' ') || undefined;
  })();

  const clipPath = crop
    ? `inset(${crop.y}px ${width - (crop.x + crop.w)}px ${height - (crop.y + crop.h)}px ${crop.x}px)`
    : undefined;

  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{
        width,
        height,
        display: 'block',
        transform: cssTransform,
        clipPath,
        transformOrigin: 'center center',
      }}
    />
  );
}
