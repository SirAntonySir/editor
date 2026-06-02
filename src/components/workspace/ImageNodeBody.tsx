import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  sourceWidth: number;
  sourceHeight: number;
}

export function ImageNodeBody({ imageNodeId, layerIds, sourceWidth, sourceHeight }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({
    imageNodeId, layerIds, sourceWidth, sourceHeight,
  });
  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{ display: 'block' }}
    />
  );
}
