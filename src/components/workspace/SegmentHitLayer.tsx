import { useCallback, useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useBackendState } from '@/store/backend-state-slice';
import { useMobileSam } from '@/hooks/useMobileSam';
import { useEditorStore } from '@/store';
import { GLOBAL_SCOPE } from '@/types/scope';
import { backendTools } from '@/lib/backend-tools';
import { maskStore } from '@/core/mask-store';
import { maskToPngBase64 } from '@/lib/segmentation/mask-png';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { Kbd } from '@/components/ui/kbd';
import { toast } from '@/components/ui/Toast';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { SegmentMaskPreview } from './SegmentMaskPreview';
import type { SamPoint, DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentHitLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
  /** True when the image-node is in objects mode. Drives left-click
   *  behaviour: in objects mode an empty-area click runs SAM; in layers
   *  mode it just clears the active mask scope so the image-node selects.
   *  Right-click hit-test against existing objects runs in BOTH modes so
   *  the user can rename/delete/etc. objects without entering objects
   *  mode first. */
  objectsMode: boolean;
}

interface CandidateState {
  points: SamPoint[];
  mask: DecodedMask | null;
}

function clientToNormalised(
  evt: { clientX: number; clientY: number },
  el: HTMLElement,
): [number, number] {
  const rect = el.getBoundingClientRect();
  return [(evt.clientX - rect.left) / rect.width, (evt.clientY - rect.top) / rect.height];
}

function isInsideMask(nx: number, ny: number, mask: DecodedMask | null): boolean {
  if (!mask) return false;
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(nx * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(ny * mask.height)));
  return mask.data[y * mask.width + x] === 255;
}

export function SegmentHitLayer({
  imageNodeId, widthPx, heightPx, objectsMode,
}: SegmentHitLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hoveringObject, setHoveringObject] = useState(false);
  // Read from useBackendState — this is the authoritative tool-session
  // store and stays populated across reloads (reattached from localStorage
  // via useBackendSession). useAiSession.sessionId mirrors the same id
  // only after the user runs analyze, so reading it here would silently
  // bail commitCandidate post-reload.
  const sessionId = useBackendState((s) => s.sessionId);
  const samCapability = useMobileSam(imageNodeId);
  const existingObjects = useImageNodeObjects(imageNodeId);

  const [candidate, setCandidate] = useState<CandidateState | null>(null);
  // Tracks in-flight decode calls so a newer click can invalidate an older
  // decode's setState. Without this, a slow first decode would clobber a
  // faster second click's candidate after it returned.
  const decodeSeqRef = useRef(0);

  const cancelCandidate = useCallback(() => setCandidate(null), []);

  const commitCandidate = useCallback(async () => {
    const c = candidate;
    if (!c?.mask || !sessionId) return;
    const pngBase64 = await maskToPngBase64(c.mask);
    const hasNegativePoint = c.points.some((p) => p.label === 0);
    const autoName = `Object ${existingObjects.length + 1}`;
    const env = await backendTools.propose_mask(sessionId, {
      imageNodeId,
      pngBase64,
      paths: [],
      label: autoName,
      origin: hasNegativePoint ? 'client_refinement' : 'client_new',
    });
    if (env.ok) {
      // Record the imageNodeId-for-this-mask mapping on the client. The
      // SSE event doesn't carry it, so without this the objects layer
      // can't filter masksIndex per image-node.
      const maskId = env.output?.maskId;
      if (maskId) {
        objectOwnership.set(maskId, imageNodeId);
        // Inject locally with the bytes we already have, instead of waiting
        // for the SSE round-trip. layerId resolves to the image node's
        // first image layer so the renderer's selected-mask overlay paints
        // (it gates on layerSet.has(mask.layerId)).
        const editor = useEditorStore.getState();
        const node = editor.imageNodes[imageNodeId];
        const layerId = node?.layerIds.find(
          (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
        );
        if (layerId) {
          maskStore.injectWithId({
            id: maskId,
            layerId,
            label: autoName,
            width: c.mask.width,
            height: c.mask.height,
            data: c.mask.data,
            source: hasNegativePoint ? 'sam-points' : 'sam-point',
            createdAt: Date.now(),
          });
        }
        // Promote the new object to the active scope so subsequent
        // toolrail / Cmd+K adjustments target it instead of the layer.
        editor.setActiveScope({ kind: 'mask', mask_id: maskId });
        // Drop back to layers mode — the user is done segmenting, and the
        // committed object's actions are still reachable from the image-
        // node's ContextMenu when the active scope points at this mask.
        editor.setImageNodeMode(imageNodeId, 'layers');
      }
      toast.info(`Saved as "${autoName}"`);
      setCandidate(null);
    } else {
      toast.info(`Save failed: ${env.error?.message ?? 'unknown error'}`);
    }
  }, [candidate, sessionId, imageNodeId, existingObjects.length]);

  // Esc / Enter while a candidate is live.
  useEffect(() => {
    if (!candidate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelCandidate(); }
      if (e.key === 'Enter') { e.preventDefault(); void commitCandidate(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [candidate, commitCandidate, cancelCandidate]);

  const runDecode = useCallback(async (points: SamPoint[]) => {
    const seq = ++decodeSeqRef.current;
    setCandidate({ points, mask: null });
    const mask = await samCapability.decode(points);
    if (seq !== decodeSeqRef.current) return; // superseded by a newer click
    setCandidate({ points, mask });
  }, [samCapability]);

  // Right-click hit-test. Two layers:
  //   1) An uncommitted candidate (live SAM preview) takes precedence —
  //      right-click inside it offers Commit / Cancel via the hidden
  //      candidate Trigger below.
  //   2) Otherwise hit-test committed object masks; the label chip is too
  //      small to right-click directly, so we re-dispatch contextmenu to
  //      the matching label's Radix Trigger.
  // Misses fall through silently (no menu — there's no Trigger to open).
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      // Re-entry guard: our re-dispatched contextmenu events land on a
      // Radix trigger element (the hidden candidate span, or an object
      // label in a sibling layer). When the candidate trigger lives inside
      // SegmentHitLayer, the synthesized event bubbles right back up into
      // this handler and would recurse infinitely. Bail when the event
      // target is already a trigger we'd want to redispatch to.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-candidate-trigger], [data-object-id]')) return;
      const [nx, ny] = clientToNormalised(e, el);

      if (candidate?.mask && isInsideMask(nx, ny, candidate.mask)) {
        e.preventDefault();
        e.stopPropagation();
        const trig = el.querySelector('[data-candidate-trigger]') as HTMLElement | null;
        if (!trig) return;
        trig.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, view: window,
          clientX: e.clientX, clientY: e.clientY, button: 2,
        }));
        return;
      }

      const hit = existingObjects.find((obj) => {
        const x = Math.min(obj.mask.width - 1, Math.max(0, Math.floor(nx * obj.mask.width)));
        const y = Math.min(obj.mask.height - 1, Math.max(0, Math.floor(ny * obj.mask.height)));
        return obj.mask.data[y * obj.mask.width + x] === 255;
      });
      if (!hit) {
        // Objects mode: empty-area right-click stays silent (matches the
        // previous behaviour where the hit-layer absorbed contextmenu
        // entirely). Layers mode: let the event bubble up to the
        // image-node's ContextMenu.Trigger that wraps this layer.
        if (objectsMode) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const trig = document.querySelector(`[data-object-id="${hit.id}"]`) as HTMLElement | null;
      if (!trig) return;
      trig.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: e.clientX, clientY: e.clientY, button: 2,
      }));
    },
    [candidate, existingObjects, objectsMode],
  );

  // Track whether the cursor is currently over an object's mask pixels.
  // Drives a `cursor: pointer` swap so the user can tell when a click will
  // select an object vs drag the node (layers mode) / draw a SAM point
  // (objects mode). Throttling is unnecessary — React batches per frame and
  // the hit-test is O(#objects); even with 10 objects it's a handful of
  // pixel reads per pointermove.
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      const overObject = existingObjects.some((obj) => {
        const x = Math.min(obj.mask.width - 1, Math.max(0, Math.floor(nx * obj.mask.width)));
        const y = Math.min(obj.mask.height - 1, Math.max(0, Math.floor(ny * obj.mask.height)));
        return obj.mask.data[y * obj.mask.width + x] === 255;
      });
      setHoveringObject((prev) => (prev === overObject ? prev : overObject));
    },
    [existingObjects],
  );
  const handlePointerLeave = useCallback(() => setHoveringObject(false), []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);

      // Object-pixel hit-test runs in both modes: clicking on a committed
      // object selects it (sets the active mask scope) so subsequent
      // adjustments target that object. Image-node selection still happens
      // via the normal React Flow click handling — we don't preventDefault.
      const editor = useEditorStore.getState();
      const objectHit = existingObjects.find((obj) => {
        const x = Math.min(obj.mask.width - 1, Math.max(0, Math.floor(nx * obj.mask.width)));
        const y = Math.min(obj.mask.height - 1, Math.max(0, Math.floor(ny * obj.mask.height)));
        return obj.mask.data[y * obj.mask.width + x] === 255;
      });
      if (objectHit) {
        editor.setActiveScope({ kind: 'mask', mask_id: objectHit.id });
        editor.setActiveImageNode(imageNodeId);
        return;
      }

      if (!objectsMode) {
        // Layers mode: empty-area click clears the mask scope so the image
        // body acts as a global target again. React Flow's own node-click
        // handling still selects the ImageNode (we don't stop the event).
        if (editor.activeScope.kind === 'mask') {
          editor.setActiveScope(GLOBAL_SCOPE);
        }
        return;
      }

      // Objects mode — fall through to SAM. Shift-click while a candidate
      // is live: append a refinement point. Positive (label 1) if outside
      // the current mask, negative (label 0) if inside — mirrors the SAM
      // convention for click-driven refinement.
      if (e.shiftKey && candidate) {
        const insideMask = isInsideMask(nx, ny, candidate.mask);
        const point: SamPoint = { x: nx, y: ny, label: insideMask ? 0 : 1 };
        void runDecode([...candidate.points, point]);
        return;
      }

      // Plain click (or shift without a candidate): start a fresh candidate.
      void runDecode([{ x: nx, y: ny, label: 1 }]);
    },
    [candidate, runDecode, existingObjects, imageNodeId, objectsMode],
  );

  return (
    <div
      ref={layerRef}
      data-testid="segment-hit-layer"
      data-image-node-id={imageNodeId}
      // Classes:
      //  - objects mode: `nodrag nopan` opts out of React Flow's pointer
      //    handling so SAM clicks aren't swallowed; cursor is a crosshair
      //    for aim.
      //  - layers mode: `workspace-drag-handle` opts INTO React Flow's
      //    body-as-drag-handle path (the node otherwise gates drag on this
      //    class — see CanvasWorkspace's `dragHandle` config). Cursor is
      //    `pointer` over an object's mask pixels (about to select), `grab`
      //    elsewhere (about to move the node).
      className={
        objectsMode
          ? 'nodrag nopan absolute inset-0 cursor-crosshair'
          : `workspace-drag-handle absolute inset-0 ${
              hoveringObject ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
            }`
      }
      style={{ pointerEvents: 'auto', zIndex: 5 }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <SegmentMaskPreview
        mask={candidate?.mask ?? null}
        widthPx={widthPx}
        heightPx={heightPx}
      />
      {candidate && (
        <div
          data-testid="segment-candidate-hint"
          data-state={candidate.mask ? 'ready' : 'pending'}
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] bg-surface text-text-primary text-[10px] leading-none border border-separator shadow-sm whitespace-nowrap flex items-center gap-1.5"
        >
          {candidate.mask ? (
            <>
              <Kbd keys="enter" className="ml-0" />
              <span>commit</span>
              <span className="opacity-40">·</span>
              <Kbd keys="esc" className="ml-0" />
              <span>cancel</span>
              <span className="opacity-40">·</span>
              <Kbd keys="shift" className="ml-0" />
              <span>+ click to refine</span>
            </>
          ) : (
            <span>Segmenting…</span>
          )}
        </div>
      )}
      {/* Hidden Trigger that handleContextMenu re-dispatches into when the
       *  cursor is over a live candidate. Mounted only while the candidate
       *  exists so misses (no candidate) fall through silently. */}
      {candidate?.mask && (
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <span data-candidate-trigger style={{ position: 'absolute', width: 0, height: 0 }} />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content className="overlay p-1 min-w-[160px] z-50">
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none flex items-center justify-between gap-3"
                onSelect={() => void commitCandidate()}
              >
                <span>Commit</span>
                <Kbd keys="enter" className="ml-0" />
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none flex items-center justify-between gap-3 text-text-secondary"
                onSelect={cancelCandidate}
              >
                <span>Cancel</span>
                <Kbd keys="esc" className="ml-0" />
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      )}
    </div>
  );
}
