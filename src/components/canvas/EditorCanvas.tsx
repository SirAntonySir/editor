import { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { useEditor } from '@/components/EditorProvider';
import { ToolRegistry } from '@/lib/tool-registry';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { useAdjustmentPipeline } from './useAdjustmentPipeline';

interface EditorCanvasProps {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>;
}

export function EditorCanvas({ canvasRef }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const spaceHeld = useRef(false);

  const { toolContext } = useEditor();

  // Connect WebGL adjustment pipeline
  useAdjustmentPipeline(canvasRef);

  // Initialize Fabric canvas
  useEffect(() => {
    const canvasEl = canvasElRef.current;
    const container = containerRef.current;
    if (!canvasEl || !container) return;

    const { width, height } = container.getBoundingClientRect();

    const canvas = new fabric.Canvas(canvasEl, {
      width,
      height,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
    });

    canvasRef.current = canvas;

    useEditorStore.getState().setCanvasDimensions(width, height);

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      canvas.setDimensions({ width: w, height: h });
      useEditorStore.getState().setCanvasDimensions(w, h);
      canvas.renderAll();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom with scroll wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
      const e = opt.e;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let zoom = canvas.getZoom();
      zoom *= 0.999 ** delta;
      zoom = Math.max(0.1, Math.min(32, zoom));

      const point = canvas.getScenePoint(e);
      canvas.zoomToPoint(point, zoom);
      useEditorStore.getState().setZoom(zoom);
      canvas.renderAll();
    };

    canvas.on('mouse:wheel', handleWheel);
    return () => {
      canvas.off('mouse:wheel', handleWheel);
    };
  }, [canvasRef]);

  // Zoom keyboard shortcuts (Cmd/Ctrl +/-/0)
  useEffect(() => {
    const isMac = /Mac/.test(navigator.userAgent);

    const handleZoomKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      let newZoom: number | null = null;
      let fit = false;

      if (e.key === '=' || e.key === '+') {
        newZoom = canvas.getZoom() * 1.25;
      } else if (e.key === '-') {
        newZoom = canvas.getZoom() / 1.25;
      } else if (e.key === '0') {
        fit = true;
      } else if (e.key === '1') {
        newZoom = 1;
      } else {
        return;
      }

      e.preventDefault();

      if (fit) {
        const obj = canvas.getObjects()[0];
        if (!obj) return;
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        const canvasW = canvas.getWidth();
        const canvasH = canvas.getHeight();
        const objW = obj.width * (obj.scaleX ?? 1);
        const objH = obj.height * (obj.scaleY ?? 1);
        const z = Math.min(canvasW / objW, canvasH / objH) * 0.9;
        const center = new fabric.Point(canvasW / 2, canvasH / 2);
        canvas.zoomToPoint(center, z);
        const objCenter = obj.getCenterPoint();
        const vpt = canvas.viewportTransform;
        if (vpt) {
          vpt[4] = canvasW / 2 - objCenter.x * z;
          vpt[5] = canvasH / 2 - objCenter.y * z;
        }
        useEditorStore.getState().setZoom(z);
        useEditorStore.getState().setFitMode('fit');
        useEditorStore.getState().setPan(vpt?.[4] ?? 0, vpt?.[5] ?? 0);
      } else if (newZoom !== null) {
        const clamped = Math.max(0.1, Math.min(32, newZoom));
        const center = new fabric.Point(canvas.getWidth() / 2, canvas.getHeight() / 2);
        canvas.zoomToPoint(center, clamped);
        useEditorStore.getState().setZoom(clamped);
      }
      canvas.requestRenderAll();
    };

    document.addEventListener('keydown', handleZoomKey);
    return () => document.removeEventListener('keydown', handleZoomKey);
  }, [canvasRef]);

  // Pan with middle-click or space+drag
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeld.current = true;
        if (canvas.upperCanvasEl) {
          canvas.upperCanvasEl.style.cursor = 'grab';
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        isPanning.current = false;
        if (canvas.upperCanvasEl) {
          canvas.upperCanvasEl.style.cursor = 'default';
        }
      }
    };

    const handleMouseDown = (opt: fabric.TPointerEventInfo) => {
      const e = opt.e as PointerEvent;
      if (e.button === 1 || spaceHeld.current) {
        isPanning.current = true;
        lastPointer.current = { x: e.clientX, y: e.clientY };
        canvas.selection = false;
        if (canvas.upperCanvasEl) {
          canvas.upperCanvasEl.style.cursor = 'grabbing';
        }
      }
    };

    const handleMouseMove = (opt: fabric.TPointerEventInfo) => {
      if (!isPanning.current) return;
      const e = opt.e as PointerEvent;
      const vpt = canvas.viewportTransform;
      if (!vpt) return;
      vpt[4] += e.clientX - lastPointer.current.x;
      vpt[5] += e.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.clientX, y: e.clientY };

      const store = useEditorStore.getState();
      store.setPan(vpt[4], vpt[5]);
      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      if (isPanning.current) {
        isPanning.current = false;
        canvas.selection = true;
        if (canvas.upperCanvasEl) {
          canvas.upperCanvasEl.style.cursor = spaceHeld.current ? 'grab' : 'default';
        }
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [canvasRef]);

  // Forward pointer events to active tool
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const forwardEvent = (type: 'down' | 'move' | 'up') => (opt: fabric.TPointerEventInfo) => {
      if (isPanning.current) return;
      const { activeTool } = useEditorStore.getState();
      const toolDef = ToolRegistry.get(activeTool);
      if (!toolDef) return;

      const e = opt.e as PointerEvent;
      const point = canvas.getScenePoint(e);
      const canvasEvent = {
        x: point.x,
        y: point.y,
        rawEvent: e,
        fabricEvent: opt,
      };

      if (type === 'down') toolDef.onPointerDown?.(canvasEvent, toolContext);
      if (type === 'move') toolDef.onPointerMove?.(canvasEvent, toolContext);
      if (type === 'up') toolDef.onPointerUp?.(canvasEvent, toolContext);
    };

    canvas.on('mouse:down', forwardEvent('down'));
    canvas.on('mouse:move', forwardEvent('move'));
    canvas.on('mouse:up', forwardEvent('up'));

    return () => {
      canvas.off('mouse:down');
      canvas.off('mouse:move');
      canvas.off('mouse:up');
    };
  }, [canvasRef, toolContext]);

  // Handle file drop for image loading
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      await loadImageToCanvas(file, canvasRef.current);
    },
    [canvasRef]
  );

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-canvas-bg"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <canvas ref={canvasElRef} />
    </div>
  );
}

export async function loadImageToCanvas(file: File, canvas: fabric.Canvas | null) {
  if (!canvas) return;

  const bitmap = await createImageBitmap(file);

  // Create an OffscreenCanvas to get ImageData from the bitmap
  const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(bitmap, 0, 0);

  const dataURL = await new Promise<string>((resolve) => {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = bitmap.width;
    tmpCanvas.height = bitmap.height;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return;
    tmpCtx.drawImage(bitmap, 0, 0);
    resolve(tmpCanvas.toDataURL());
  });

  const img = await fabric.FabricImage.fromURL(dataURL);

  // Fit image to canvas viewport
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();
  const scale = Math.min(canvasWidth / bitmap.width, canvasHeight / bitmap.height) * 0.9;

  img.set({
    scaleX: scale,
    scaleY: scale,
    left: canvasWidth / 2,
    top: canvasHeight / 2,
  });
  img.setControlVisible('mtr', false);

  canvas.add(img);
  canvas.setActiveObject(img);
  canvas.renderAll();

  // Add to layer store
  const layerId = crypto.randomUUID();
  useEditorStore.getState().addLayer({
    id: layerId,
    type: 'image',
    name: file.name,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
  });

  // Register pixel data (creates source + working copies)
  CanvasRegistry.register(layerId, offscreen);

  bitmap.close();
}
