import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
  bypassAdjustments?: boolean;
}

export function ImageNodeBody({ imageNodeId, layerIds, width, height, bypassAdjustments }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({ imageNodeId, layerIds, width, height, bypassAdjustments });

  return (
    <canvas
      ref={canvasRef}
      aria-label="Image node body"
      className="bg-surface-secondary border-y border-separator"
      style={{ width, height, display: 'block' }}
    />
  );
}
