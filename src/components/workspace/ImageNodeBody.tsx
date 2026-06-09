import { useImageNodeRender } from '@/hooks/useImageNodeRender';

interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  sourceWidth: number;
  sourceHeight: number;
  /** Canvas-space display width. Sets the visible canvas's CSS width so the
   *  body always renders at the node's layout box, independent of source pixels. */
  displayWidth: number;
  /** Canvas-space display height. Derived in the caller from the effective
   *  source aspect ratio (post-crop/rotate) so the box matches what renders. */
  displayHeight: number;
  bypassAdjustments?: boolean;
}

export function ImageNodeBody({
  imageNodeId,
  layerIds,
  sourceWidth,
  sourceHeight,
  displayWidth,
  displayHeight,
  bypassAdjustments,
}: ImageNodeBodyProps) {
  const { canvasRef } = useImageNodeRender({
    imageNodeId,
    layerIds,
    sourceWidth,
    sourceHeight,
    displayWidth,
    displayHeight,
    bypassAdjustments,
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
