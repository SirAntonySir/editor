import { useEffect, useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { useEditor } from '@/components/EditorProvider';
import { ToolRegistry } from '@/lib/tool-registry';
import { CanvasRegistry } from '@/lib/canvas-registry';
import { editorDocument } from '@/core/document';
import { useAdjustmentPipeline } from './useAdjustmentPipeline';
import { useFabricOverlays } from './useFabricOverlays';
import { SelectionActionsOverlay } from './SelectionActionsOverlay';
import { SegmentOverlay } from './SegmentOverlay';
import { FullImageOutline } from './FullImageOutline';
import { CanvasWidgetLayer } from '@/components/widget/CanvasWidgetLayer';

interface EditorCanvasProps {
  canvasRef: React.MutableRefObject<fabric.Canvas | null>;
}

/** Fit the first canvas object into the viewport with 90% padding. */
function fitCanvasToView(canvas: fabric.Canvas) {
  const obj = canvas.getObjects()[0];
  if (!obj) return;
  const w = canvas.getWidth();
  const h = canvas.getHeight();
  const objW = obj.width * (obj.scaleX ?? 1);
  const objH = obj.height * (obj.scaleY ?? 1);
  if (objW === 0 || objH === 0) return;
  const z = Math.min(w / objW, h / objH) * 0.9;
  const objCenter = obj.getCenterPoint();
  const tx = w / 2 - objCenter.x * z;
  const ty = h / 2 - objCenter.y * z;
  canvas.setViewportTransform([z, 0, 0, z, tx, ty]);
}

export function EditorCanvas({ canvasRef }: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const spaceHeld = useRef(false);

  const editorMode = useEditorStore((s) => s.editorMode);
  const editorModeRef = useRef(editorMode);
  editorModeRef.current = editorMode;
  const objectStateSnapshot = useRef<WeakMap<fabric.FabricObject, { selectable: boolean; evented: boolean }>>(new WeakMap());

  const { toolContext } = useEditor();

  // Connect WebGL adjustment pipeline
  useAdjustmentPipeline(canvasRef);
  // Render mask / annotation overlays as Fabric children of the active image
  // so pan/zoom/rotate/flip are tracked automatically.
  useFabricOverlays(canvasRef);

  // Hydrate canvas from store when layers appear or change (session restore, edp load)
  const layers = useEditorStore((s) => s.layers);
  const layerCountRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    const prevCount = layerCountRef.current;
    layerCountRef.current = layers.length;
    if (!canvas || layers.length === 0) return;

    // Hydrate when:
    //  1. Layers appear for the first time (0 → N) — session restore
    //  2. Canvas has no Fabric objects but store has layers — edp/session load after a previous image
    const hasNoObjects = canvas.getObjects().filter((o) => o instanceof fabric.FabricImage).length === 0;
    if (prevCount > 0 && !hasNoObjects) return;

    const timer = setTimeout(() => hydrateCanvasFromStore(canvas), 50);
    return () => clearTimeout(timer);
  }, [layers, canvasRef]);

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
      // Auto-fit when in graph mode (preview pane)
      if (editorModeRef.current === 'graph') {
        fitCanvasToView(canvas);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disable interaction & refit when entering graph mode (preview)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (editorMode === 'graph') {
      canvas.selection = false;
      canvas.discardActiveObject();
      const snapshot = objectStateSnapshot.current;
      canvas.forEachObject((obj) => {
        snapshot.set(obj, { selectable: obj.selectable, evented: obj.evented });
        obj.selectable = false;
        obj.evented = false;
      });
      // Fit after container resize settles
      const timer = setTimeout(() => fitCanvasToView(canvas), 60);
      return () => clearTimeout(timer);
    } else {
      canvas.selection = true;
      const snapshot = objectStateSnapshot.current;
      canvas.forEachObject((obj) => {
        const saved = snapshot.get(obj);
        obj.selectable = saved?.selectable ?? true;
        obj.evented = saved?.evented ?? true;
      });
      // Re-fit after leaving graph mode (container resizes from split pane to full)
      const timer = setTimeout(() => {
        fitCanvasToView(canvas);
        const z = canvas.getZoom();
        const vpt = canvas.viewportTransform;
        useEditorStore.getState().setZoom(z);
        useEditorStore.getState().setFitMode('fit');
        useEditorStore.getState().setPan(vpt?.[4] ?? 0, vpt?.[5] ?? 0);
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [editorMode, canvasRef]);

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

  // Handle file drop for image or .edp loading
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.name.endsWith('.edp')) {
        await editorDocument.openEdp(file);
        hydrateCanvasFromStore(canvasRef.current);
      } else if (file.type.startsWith('image/')) {
        await loadImageToCanvas(file, canvasRef.current);
      }
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
      <SegmentOverlay fabricCanvasRef={canvasRef} />
      <FullImageOutline fabricCanvasRef={canvasRef} />
      <CanvasWidgetLayer fabricCanvasRef={canvasRef} />
      <SelectionActionsOverlay />
    </div>
  );
}

/**
 * Hydrate the Fabric canvas from pixel data already in the store.
 * Used after session restore / .edp load when no File object is available.
 */
export function hydrateCanvasFromStore(canvas: fabric.Canvas | null) {
  if (!canvas) return;

  const state = useEditorStore.getState();
  if (state.layers.length === 0) return;

  // Reset viewport before adding objects
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
  canvas.clear();

  // Build a Fabric image for each image layer
  for (const layer of state.layers) {
    if (layer.type !== 'image') continue;
    const working = CanvasRegistry.get(layer.id);
    if (!working || working.width === 0) continue;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = working.width;
    tmpCanvas.height = working.height;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) continue;
    tmpCtx.drawImage(working, 0, 0);

    const img = new fabric.FabricImage(tmpCanvas);

    const visW = img.width;
    const visH = img.height;
    const canvasWidth = canvas.getWidth();
    const canvasHeight = canvas.getHeight();
    const scale = Math.min(canvasWidth / visW, canvasHeight / visH) * 0.9;

    img.set({
      scaleX: scale,
      scaleY: scale,
      left: canvasWidth / 2,
      top: canvasHeight / 2,
    });
    img.setControlVisible('mtr', false);

    canvas.add(img);
  }

  if (canvas.getObjects().length > 0) {
    canvas.setActiveObject(canvas.getObjects()[0]);
  }

  // Fit to viewport and sync store
  fitCanvasToView(canvas);
  const z = canvas.getZoom();
  const vpt = canvas.viewportTransform;
  useEditorStore.getState().setZoom(z);
  useEditorStore.getState().setFitMode('fit');
  useEditorStore.getState().setPan(vpt?.[4] ?? 0, vpt?.[5] ?? 0);
  canvas.renderAll();

  // Bump pixelVersion so the adjustment pipeline re-renders now that
  // the Fabric canvas has objects. The pipeline subscriber may have
  // already fired (and found no objects) before hydration ran.
  useEditorStore.getState().bumpPixelVersion();
}

export async function loadImageToCanvas(file: File, canvas: fabric.Canvas | null) {
  if (!canvas) return;

  // Let EditorDocument handle state, pixels, and history
  await editorDocument.openImage(file);

  // Now set up the Fabric.js visual representation
  const state = useEditorStore.getState();
  const layerId = state.activeLayerId;
  if (!layerId) return;

  const working = CanvasRegistry.get(layerId);
  if (!working) return;

  // Create HTMLCanvasElement from OffscreenCanvas (no data URL roundtrip)
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = working.width;
  tmpCanvas.height = working.height;
  const tmpCtx = tmpCanvas.getContext('2d');
  if (!tmpCtx) return;
  tmpCtx.drawImage(working, 0, 0);

  const img = new fabric.FabricImage(tmpCanvas);

  // Fit image to canvas viewport
  const canvasWidth = canvas.getWidth();
  const canvasHeight = canvas.getHeight();
  const scale = Math.min(canvasWidth / working.width, canvasHeight / working.height) * 0.9;

  img.set({
    scaleX: scale,
    scaleY: scale,
    left: canvasWidth / 2,
    top: canvasHeight / 2,
  });
  img.setControlVisible('mtr', false);

  canvas.clear();
  canvas.add(img);
  canvas.setActiveObject(img);
  canvas.renderAll();
}
