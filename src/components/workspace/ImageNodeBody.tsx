import { useImageNodeRender } from '@/hooks/useImageNodeRender';
import { useBackendState } from '@/store/backend-state-slice';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  sourceWidth: number;
  sourceHeight: number;
}

interface RotateState { angle: number; flip_h: boolean; flip_v: boolean }
interface CropState { x: number; y: number; w: number; h: number }

function useRotateState(imageNodeId: string): RotateState | null {
  return useBackendState((s) => {
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:rotate`,
    );
    return node ? (node.params as unknown as RotateState) : null;
  });
}

function useCropState(imageNodeId: string): CropState | null {
  return useBackendState((s) => {
    const node = s.snapshot?.operation_graph.nodes.find(
      (n) => n.id === `transform:${imageNodeId}:crop`,
    );
    return node ? (node.params as unknown as CropState) : null;
  });
}

function effectiveSize(
  source: { w: number; h: number },
  rotateAngle: number | null,
): { w: number; h: number } {
  if (rotateAngle == null) return { w: source.w, h: source.h };
  const a = ((rotateAngle % 360) + 360) % 360;
  if (Math.abs(a - 90) < 1 || Math.abs(a - 270) < 1) return { w: source.h, h: source.w };
  return { w: source.w, h: source.h };
}

export function ImageNodeBody({ imageNodeId, layerIds, sourceWidth, sourceHeight }: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({
    imageNodeId, layerIds, width: sourceWidth, height: sourceHeight,
  });
  const rotate = useRotateState(imageNodeId);
  const crop = useCropState(imageNodeId);

  const eff = effectiveSize({ w: sourceWidth, h: sourceHeight }, rotate ? rotate.angle : null);

  // Canvas transform: centring first so the rotation pivots around the canvas
  // centre, then the rotation + flip(s).
  const parts: string[] = ['translate(-50%, -50%)'];
  if (rotate) {
    if (rotate.angle) parts.push(`rotate(${rotate.angle}deg)`);
    if (rotate.flip_h) parts.push('scaleX(-1)');
    if (rotate.flip_v) parts.push('scaleY(-1)');
  }
  const transform = parts.join(' ');

  const clipPath = crop
    ? `inset(${crop.y}px ${sourceWidth - (crop.x + crop.w)}px ${sourceHeight - (crop.y + crop.h)}px ${crop.x}px)`
    : undefined;

  return (
    <div
      data-testid="image-node-body"
      className="relative overflow-hidden bg-surface-secondary border-y border-separator"
      style={{ width: eff.w, height: eff.h }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Image node body"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: sourceWidth,
          height: sourceHeight,
          transform,
          clipPath,
          display: 'block',
        }}
      />
    </div>
  );
}
