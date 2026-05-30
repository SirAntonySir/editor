import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function ImageNodeBody({ imageNodeId, layerIds, width, height }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height });
  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{ width, height, display: 'block' }}
    />
  );
}
