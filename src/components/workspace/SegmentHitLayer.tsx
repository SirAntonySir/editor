import { useCallback, useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { useBackendState } from '@/store/backend-state-slice';
import { useMobileSam } from '@/hooks/useMobileSam';
import { useEditorStore } from '@/store';
import {
  runCandidateVerb,
  invertMask,
  type CandidateVerb,
} from '@/lib/segmentation/candidate-actions';
import { extractObjectToImageNode } from '@/lib/segmentation/object-actions';
import { editorDocument } from '@/core/document';
import { useSegmentExtractDrag } from '@/hooks/useSegmentExtractDrag';
import { Kbd } from '@/components/ui/kbd';
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
  label?: string;
  origin?: 'client_refinement' | 'client_new' | 'client_extracted';
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

  // Done segmenting after a committing action: drop the live selection and
  // return to layers mode (the resulting object's actions stay reachable).
  const finishSelection = useCallback(() => {
    setCandidate(null);
    useEditorStore.getState().setImageNodeMode(imageNodeId, 'layers');
  }, [imageNodeId]);

  // Run a committing verb on the live selection. Materialize + action live in
  // candidate-actions; the selection only persists once a verb runs. On
  // failure the selection is kept so the user doesn't lose their pick.
  const runVerb = useCallback(async (verb: CandidateVerb) => {
    const c = candidate;
    if (!c?.mask || !sessionId) return;
    const id = await runCandidateVerb(
      verb,
      { points: c.points, mask: c.mask, label: c.label, origin: c.origin },
      { sessionId, imageNodeId, existingCount: existingObjects.length },
    );
    if (id) finishSelection();
  }, [candidate, sessionId, imageNodeId, existingObjects.length, finishSelection]);

  // Select Inverted: transform the live selection into its inverse. Stays
  // transient — no commit.
  const runInvert = useCallback(() => {
    const m = candidate?.mask;
    if (!m) return;
    setCandidate({ points: [], mask: invertMask(m), label: candidate?.label });
  }, [candidate]);

  // ── Drag-to-extract (objects mode only) ──────────────────────────────────
  // Press a mask region — the live selection or a committed object — and drag
  // it off the image to extract it to a new node at the drop point. A press
  // that doesn't pass the threshold stays a click (SAM-pick / select).
  const grabbed = useRef<{ kind: 'candidate' } | { kind: 'object'; maskId: string } | null>(null);
  const extractDrag = useSegmentExtractDrag({
    sourceImageNodeId: imageNodeId,
    label: 'Extract',
    onExtract: (dropFlow) => {
      const g = grabbed.current;
      grabbed.current = null;
      if (!g) return;
      const reposition = (nodeId: string) => {
        const n = useEditorStore.getState().imageNodes[nodeId];
        const pos = n ? { x: dropFlow.x - n.size.w / 2, y: dropFlow.y - n.size.h / 2 } : dropFlow;
        editorDocument.workspace.setNodePosition(nodeId, pos);
      };
      if (g.kind === 'object') {
        const res = extractObjectToImageNode(g.maskId, imageNodeId);
        if (res) reposition(res.imageNodeId);
        return;
      }
      // Live selection: materialize + extract (the new node becomes active),
      // then reposition it to the drop and clear the selection.
      const c = candidate;
      if (!c?.mask || !sessionId) return;
      void runCandidateVerb(
        'extract-node',
        { points: c.points, mask: c.mask, label: c.label, origin: c.origin },
        { sessionId, imageNodeId, existingCount: existingObjects.length },
      ).then((id) => {
        if (!id) return;
        const newNodeId = useEditorStore.getState().activeImageNodeId;
        if (newNodeId) reposition(newNodeId);
        finishSelection();
      });
    },
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!objectsMode) return; // layers mode: body-drags the node, don't arm
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);
      if (candidate?.mask && isInsideMask(nx, ny, candidate.mask)) {
        grabbed.current = { kind: 'candidate' };
        extractDrag.onPointerDown(e);
        return;
      }
      const objHit = existingObjects.find((obj) => isInsideMask(nx, ny, obj.mask));
      if (objHit) {
        grabbed.current = { kind: 'object', maskId: objHit.id };
        extractDrag.onPointerDown(e);
        return;
      }
      grabbed.current = null; // empty area → leave for the SAM-pick click
    },
    [objectsMode, candidate, existingObjects, extractDrag],
  );

  // Esc discards the live selection. (There is no Enter-to-save — committing
  // happens only via an explicit action verb.)
  useEffect(() => {
    if (!candidate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelCandidate(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [candidate, cancelCandidate]);

  // Allow other actions (e.g. "Select Inverted" on an object) to inject a
  // candidate so the user gets the same Save/Cancel UI they'd get from a SAM
  // click. The event fires per image-node id so multiple SegmentHitLayers
  // can coexist without cross-talk.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{
        imageNodeId: string;
        mask: { width: number; height: number; data: Uint8Array };
        label?: string;
        origin?: 'client_refinement' | 'client_new' | 'client_extracted';
      }>).detail;
      if (!detail || detail.imageNodeId !== imageNodeId) return;
      decodeSeqRef.current += 1; // invalidate any in-flight SAM decode
      setCandidate({
        points: [],
        mask: detail.mask,
        label: detail.label,
        origin: detail.origin,
      });
    };
    window.addEventListener('segment-hit:external-candidate', handler);
    return () => window.removeEventListener('segment-hit:external-candidate', handler);
  }, [imageNodeId]);

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
      // A completed extract-drag ends in a click; swallow it so we don't also
      // select/pick.
      if (extractDrag.consumeDragClick()) return;
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
        editor.setActiveObjectId(objectHit.id);
        editor.setActiveImageNode(imageNodeId);
        return;
      }

      if (!objectsMode) {
        // Layers mode: empty-area click clears the mask scope so the image
        // body acts as a global target again. React Flow's own node-click
        // handling still selects the ImageNode (we don't stop the event).
        if (editor.activeObjectId !== null) {
          editor.setActiveObjectId(null);
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
    [candidate, runDecode, existingObjects, imageNodeId, objectsMode, extractDrag],
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
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { handlePointerMove(e); extractDrag.onPointerMove(e); }}
      onPointerUp={extractDrag.onPointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {extractDrag.ghost}
      <SegmentMaskPreview
        mask={candidate?.mask ?? null}
        widthPx={widthPx}
        heightPx={heightPx}
      />
      {candidate && (
        <div
          data-testid="segment-candidate-hint"
          data-state={candidate.mask ? 'ready' : 'pending'}
          className="glass-overlay pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] text-text-primary text-[10px] leading-none whitespace-nowrap flex items-center gap-1.5"
        >
          {candidate.mask ? (
            <>
              <Kbd keys="shift" className="ml-0" />
              <span>+ click refine</span>
              <span className="opacity-40">·</span>
              <span>right-click actions</span>
              <span className="opacity-40">·</span>
              <Kbd keys="esc" className="ml-0" />
              <span>discard</span>
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
            <ContextMenu.Content className="overlay p-1 min-w-[180px] z-50">
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('extract-layer')}
              >
                Extract to new layer
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('extract-node')}
              >
                Extract to Image Node
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('convert-mask')}
              >
                Convert to Layer Mask
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none text-text-secondary"
                onSelect={runInvert}
              >
                Select Inverted
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      )}
    </div>
  );
}
