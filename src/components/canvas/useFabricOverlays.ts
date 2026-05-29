import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store';
import { maskStore, type Mask } from '@/core/mask-store';
import { maskToOutlinePathData } from '@/lib/mask-outline';
import { maskCentroid } from '@/lib/mask-centroid';
import type { MaskOverlayLayer, OutlineOverlayLayer, OverlayLayer, TextLabelOverlayLayer } from '@/types/overlay';

/**
 * Tag attached to Fabric objects we own. Used to find and clean them up
 * without disturbing user layers / crop objects / etc.
 */
const OVERLAY_TAG = '__overlayKind';
const OVERLAY_ID = '__overlayId';

interface OverlayObject extends fabric.FabricObject {
  [OVERLAY_TAG]?: OverlayLayer['kind'];
  [OVERLAY_ID]?: string;
}

/**
 * Build an HTMLCanvasElement at the mask's native resolution holding the
 * translucent fill. Reusing a DOM canvas (not OffscreenCanvas) keeps
 * compatibility with `fabric.FabricImage`'s `setElement`.
 */
function buildMaskFillCanvas(mask: Mask, fillHsl: [number, number, number], alpha: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = mask.width;
  c.height = mask.height;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(mask.width, mask.height);
  // HSL → RGB conversion (single shot, used for every pixel).
  const [h, s, l] = fillHsl;
  const { r, g, b } = hslToRgb(h, s, l);
  for (let i = 0; i < mask.data.length; i++) {
    const a = mask.data[i];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.round(a * alpha);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

/**
 * Mirror the parent image's transform onto the overlay object. The mask is
 * authored at the source-image's native resolution, so we scale by
 * (parent.renderedSize / mask.size) on each axis. Rotation, flip, position
 * are copied verbatim from the parent.
 */
function syncOverlayToParent(overlay: fabric.FabricObject, parent: fabric.FabricImage, mask: Mask): void {
  const parentScaleX = parent.scaleX ?? 1;
  const parentScaleY = parent.scaleY ?? 1;
  overlay.set({
    left: parent.left,
    top: parent.top,
    originX: parent.originX,
    originY: parent.originY,
    angle: parent.angle ?? 0,
    flipX: parent.flipX ?? false,
    flipY: parent.flipY ?? false,
    scaleX: (parent.width * parentScaleX) / mask.width,
    scaleY: (parent.height * parentScaleY) / mask.height,
    skewX: parent.skewX ?? 0,
    skewY: parent.skewY ?? 0,
  });
  overlay.setCoords();
}

/**
 * Build the list of overlay layers currently active. Derived from the
 * editor's mask refs — eventually this becomes a dedicated store slice
 * once more overlay sources exist (AI annotations, hover preview, etc.).
 */
function selectOverlayLayers(
  activeRef: string | null,
  committedRef: string | null,
  imageLayerId: string | null,
): OverlayLayer[] {
  if (!imageLayerId) return [];
  // The auto-commit flow currently flips active→committed before the user
  // ever sees a "preview" state, so for now we render fill + outline for
  // whichever mask is current. The active/committed style distinction
  // returns when real preview semantics arrive (hover preview, Enter to
  // commit, etc.).
  const ref = activeRef ?? committedRef;
  if (!ref) return [];
  const state: 'active' | 'committed' = activeRef ? 'active' : 'committed';
  const layers: OverlayLayer[] = [
    {
      kind: 'mask',
      id: `fill:${ref}`,
      anchorTo: imageLayerId,
      maskRef: ref,
      state,
    } satisfies MaskOverlayLayer,
    {
      kind: 'outline',
      id: `outline:${ref}`,
      anchorTo: imageLayerId,
      maskRef: ref,
    } satisfies OutlineOverlayLayer,
  ];

  // If the mask carries a label (from region fusion or an explicit caller),
  // anchor a text overlay at its centroid.
  const mask = maskStore.get(ref);
  if (mask?.label) {
    const centroid = maskCentroid(mask);
    if (centroid) {
      layers.push({
        kind: 'text-label',
        id: `label:${ref}`,
        anchorTo: imageLayerId,
        text: mask.label,
        anchorPoint: centroid,
      } satisfies TextLabelOverlayLayer);
    }
  }
  return layers;
}

/**
 * Keeps Fabric overlay objects in sync with the OverlayLayer list. Each
 * overlay is parented (via transform mirroring) to a FabricImage on the
 * canvas, so Fabric handles pan/zoom/rotate/flip automatically.
 */
export function useFabricOverlays(canvasRef: RefObject<fabric.Canvas | null>): void {
  const activeMaskRef = useEditorStore((s) => s.activeMaskRef);
  const committedMaskRef = useEditorStore((s) => s.committedMaskRef);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const layers = useEditorStore((s) => s.layers);

  const imageLayerId = useMemo(() => {
    return activeLayerId ?? layers.find((l) => l.type === 'image')?.id ?? null;
  }, [activeLayerId, layers]);

  const overlayLayers = useMemo(
    () => selectOverlayLayers(activeMaskRef, committedMaskRef, imageLayerId),
    [activeMaskRef, committedMaskRef, imageLayerId],
  );

  // Track which fabric objects we've created (id → object) so we can diff.
  const ownedRef = useRef<Map<string, OverlayObject>>(new Map());
  // Track parent listeners so we can detach them on cleanup.
  const parentHandlersRef = useRef<Map<OverlayObject, () => void>>(new Map());
  // rAF tick for marching-ants outline animation.
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const owned = ownedRef.current;
    const parentHandlers = parentHandlersRef.current;
    const parent = canvas
      .getObjects()
      .find((o) => o instanceof fabric.FabricImage) as fabric.FabricImage | undefined;

    const wantedIds = new Set(overlayLayers.map((l) => l.id));

    // Remove objects we no longer want.
    for (const [id, obj] of owned) {
      if (wantedIds.has(id)) continue;
      const detach = parentHandlers.get(obj);
      detach?.();
      parentHandlers.delete(obj);
      canvas.remove(obj);
      owned.delete(id);
    }

    if (!parent) {
      canvas.requestRenderAll();
      return;
    }

    // Add/update wanted overlays.
    for (const layer of overlayLayers) {
      // Text-label overlays don't carry a mask — handled elsewhere.
      if (layer.kind !== 'mask' && layer.kind !== 'outline') continue;
      const mask = maskStore.get(layer.maskRef);
      if (!mask || mask.width <= 0 || mask.height <= 0) continue;

      const existing = owned.get(layer.id);
      if (existing) {
        syncOverlayToParent(existing, parent, mask);
        continue;
      }

      let overlay: OverlayObject;
      if (layer.kind === 'mask') {
        const style = layer.style ?? {};
        const fill = style.fillHsl ?? (layer.state === 'active' ? [310, 90, 60] : [200, 90, 55]);
        const alpha = style.alpha ?? 0.45;
        const fillCanvas = buildMaskFillCanvas(mask, fill, alpha);
        overlay = new fabric.FabricImage(fillCanvas, {
          selectable: false,
          evented: false,
          excludeFromExport: true,
          objectCaching: false,
          hoverCursor: 'default',
        }) as OverlayObject;
      } else {
        // outline
        const d = maskToOutlinePathData(mask);
        if (!d) continue;
        const pathObj = new fabric.Path(d, {
          fill: '',
          stroke: 'rgba(255,255,255,0.95)',
          strokeWidth: 1.25,
          strokeUniform: true,
          strokeDashArray: [4, 3],
          selectable: false,
          evented: false,
          excludeFromExport: true,
          objectCaching: false,
          hoverCursor: 'default',
        });
        // Fabric centers the path on the bbox of its actual content. Our
        // transform math assumes the centre is at (mask.width/2, mask.height/2)
        // — i.e. the centre of the *full mask grid*, matching the parent
        // image's centre. Override pathOffset so origin-centre lines up with
        // the same point as the parent image.
        pathObj.pathOffset = new fabric.Point(mask.width / 2, mask.height / 2);
        // Force Fabric to use the full mask-grid extents as the path's
        // logical width/height so scale math (parent.size / mask.size)
        // applies the same factor as the FabricImage fill.
        pathObj.width = mask.width;
        pathObj.height = mask.height;
        overlay = pathObj as OverlayObject;
      }
      overlay[OVERLAY_TAG] = layer.kind;
      overlay[OVERLAY_ID] = layer.id;
      syncOverlayToParent(overlay, parent, mask);

      // Re-sync continuously while the parent is being interactively
      // transformed. `modified` covers post-drag updates.
      const sync = () => syncOverlayToParent(overlay, parent, mask);
      parent.on('moving', sync);
      parent.on('scaling', sync);
      parent.on('rotating', sync);
      parent.on('modified', sync);
      parent.on('skewing', sync);
      parentHandlers.set(overlay, () => {
        parent.off('moving', sync);
        parent.off('scaling', sync);
        parent.off('rotating', sync);
        parent.off('modified', sync);
        parent.off('skewing', sync);
      });

      canvas.add(overlay);
      canvas.bringObjectToFront(overlay);
      owned.set(layer.id, overlay);
    }

    canvas.requestRenderAll();

    // Start / stop the marching-ants tick depending on whether any outline
    // overlay is alive. Single rAF loop, shared across all outlines.
    const hasOutline = Array.from(owned.values()).some((o) => o[OVERLAY_TAG] === 'outline');
    if (hasOutline && tickRef.current === null) {
      const period = 700; // ms for one full dash cycle
      const dashLen = 7; // sum of strokeDashArray [4,3]
      const start = performance.now();
      const tick = (now: number) => {
        const phase = ((now - start) % period) / period;
        for (const obj of owned.values()) {
          if (obj[OVERLAY_TAG] !== 'outline') continue;
          (obj as fabric.Path).set('strokeDashOffset', -phase * dashLen);
        }
        canvas.requestRenderAll();
        tickRef.current = requestAnimationFrame(tick);
      };
      tickRef.current = requestAnimationFrame(tick);
    } else if (!hasOutline && tickRef.current !== null) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
  }, [overlayLayers, canvasRef]);

  // Final unmount cleanup — remove all owned overlays.
  useEffect(() => {
    // Capture ref values at effect-setup time so the cleanup closure has stable
    // references even if the refs change before unmount.
    const canvasSnapshot = canvasRef;
    const ownedSnapshot = ownedRef;
    const handlersSnapshot = parentHandlersRef;
    return () => {
      const canvas = canvasSnapshot.current;
      const owned = ownedSnapshot.current;
      const parentHandlers = handlersSnapshot.current;
      for (const [, detach] of parentHandlers) detach();
      parentHandlers.clear();
      if (canvas) {
        for (const [, obj] of owned) canvas.remove(obj);
      }
      owned.clear();
      if (tickRef.current !== null) {
        cancelAnimationFrame(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [canvasRef]);
}
