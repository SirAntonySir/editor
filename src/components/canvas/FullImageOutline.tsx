/* eslint-disable react-hooks/refs --
 * Intentional imperative bridge: Fabric.js has no React integration.
 * We subscribe to `after:render` and call setTick() to trigger a re-render,
 * then read fabricCanvasRef.current during render to snapshot the current
 * Fabric viewport transform and image bounds. This is the only way to overlay
 * a DOM element that tracks Fabric's coordinate space in real time.
 */
import { useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';

interface Props {
  fabricCanvasRef: React.RefObject<fabric.Canvas | null>;
}

/**
 * Blue accent outline drawn around the Fabric image bounds when the active
 * scope is global. Tracks Fabric viewport changes so zoom/pan keep the
 * outline aligned.
 */
export function FullImageOutline({ fabricCanvasRef }: Props) {
  const activeScope = useEditorStore((s) => s.activeScope);
  const [, setTick] = useState(0);

  useEffect(() => {
    const f = fabricCanvasRef.current;
    if (!f) return;
    const refresh = () => setTick((t) => t + 1);
    f.on('after:render', refresh as never);
    return () => { f.off('after:render', refresh as never); };
  }, [fabricCanvasRef]);

  const isGlobal = !activeScope || activeScope.kind === 'global';
  if (!isGlobal) return null;

  const f = fabricCanvasRef.current;
  if (!f) return null;
  const img = f.getObjects().find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;
  if (!img) return null;

  const sx = img.scaleX ?? 1;
  const sy = img.scaleY ?? 1;
  const sceneW = (img.width ?? 0) * sx;
  const sceneH = (img.height ?? 0) * sy;
  const sceneLeft = (img.left ?? 0) - sceneW / 2;
  const sceneTop = (img.top ?? 0) - sceneH / 2;

  const vpt = f.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const screenLeft = sceneLeft * vpt[0] + vpt[4];
  const screenTop = sceneTop * vpt[3] + vpt[5];
  const screenW = sceneW * vpt[0];
  const screenH = sceneH * vpt[3];

  return (
    <div
      className="absolute pointer-events-none rounded-[3px]"
      style={{
        left: screenLeft,
        top: screenTop,
        width: screenW,
        height: screenH,
        border: '2px solid var(--color-accent)',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
        zIndex: 5,
      }}
    />
  );
}
