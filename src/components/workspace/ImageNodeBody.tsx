import { useImageNodeRender } from '@/hooks/useImageNodeRender';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';

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

interface ImageNodeTransforms {
  rotate: RotateParams | null;
  crop: CropParams | null;
}

function useImageNodeTransforms(imageNodeId: string): ImageNodeTransforms {
  const fromSnapshot = useBackendState(
    useShallow((s) => {
      const nodes = s.snapshot?.operation_graph.nodes ?? [];
      const rotateNode = nodes.find((n) => n.id === `transform:${imageNodeId}:rotate`);
      const cropNode = nodes.find((n) => n.id === `transform:${imageNodeId}:crop`);
      return {
        rotate: rotateNode ? (rotateNode.params as unknown as RotateParams) : null,
        crop: cropNode ? (cropNode.params as unknown as CropParams) : null,
      };
    }),
  );
  const previewActive = useEditorStore((s) => s.cropModalImageNodeId === imageNodeId);
  const preview = useEditorStore((s) => s.cropPreview);
  if (!previewActive || !preview) return fromSnapshot;
  return {
    rotate: preview.rotate ?? fromSnapshot.rotate,
    crop:   preview.crop   ?? fromSnapshot.crop,
  };
}

export function ImageNodeBody({ imageNodeId, layerIds, width, height }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height });
  const { rotate, crop } = useImageNodeTransforms(imageNodeId);

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
