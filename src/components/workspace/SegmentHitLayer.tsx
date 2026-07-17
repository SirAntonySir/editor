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
import { copyObjectToImageNode } from '@/lib/segmentation/object-actions';
import { editorDocument } from '@/core/document';
import { useSegmentExtractDrag } from '@/hooks/useSegmentExtractDrag';
import { Loader2 } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useImageNodeObjects } from '@/hooks/useImageNodeObjects';
import { maskStore } from '@/core/mask-store';
import { SegmentMaskPreview } from './SegmentMaskPreview';
import {
  lassoRasterSize,
  rasterizeLassoPath,
  shouldAppendPoint,
  type LassoPoint,
} from '@/lib/segmentation/lasso';
import { bboxOfPath, boxPrompt, isMaskAcceptable } from '@/lib/segmentation/magic-lasso';
import type { SamPoint, DecodedMask } from '@/lib/segmentation/mobile-sam-types';

interface SegmentHitLayerProps {
  imageNodeId: string;
  widthPx: number;
  heightPx: number;
  /** Natural image dimensions — drives the lasso raster resolution (capped
   *  long edge). Falls back to the display px when absent. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** True when the image-node is in objects mode. Drives left-click
   *  behaviour: in objects mode an empty-area click runs SAM (point tool)
   *  or draws a freehand polygon (lasso tool — no SAM call); in layers
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
  origin?: 'client_refinement' | 'client_new' | 'client_extracted' | 'client_lasso';
  /** Normalized lasso vertices — forwarded to propose_mask's `paths`. */
  paths?: number[][][];
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
  imageNodeId, widthPx, heightPx, sourceWidth, sourceHeight, objectsMode,
}: SegmentHitLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [hoveringObject, setHoveringObject] = useState(false);
  // Cursor-following tooltip: layer-local px of the pointer while it is over
  // an existing object's mask pixels. The object NAME lives here (not in a
  // persistent chip/tag) — the photo stays clean, hover reveals. See spec
  // 2026-07-08-hover-only-mask-overlay-design.md.
  const [cursorTip, setCursorTip] = useState<{ x: number; y: number } | null>(null);
  const hoveredObjectId = useEditorStore((s) => s.hoveredObjectId);
  const hoveredLabel = hoveredObjectId ? (maskStore.get(hoveredObjectId)?.label ?? null) : null;
  const objectSelectTool = useEditorStore((s) => s.objectSelectTool);
  const lassoActive = objectsMode && objectSelectTool === 'lasso';
  const magicActive = objectsMode && objectSelectTool === 'magic';
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
  // True while a point-tool SAM decode is in flight. Gates further point clicks
  // so spam-clicking can't stack decodes — the user must wait for the current
  // result before clicking again.
  const decodingRef = useRef(false);

  // ── Lasso drawing state ──────────────────────────────────────────────────
  // Ref accumulates vertices (pointermove-rate); state mirrors it for the SVG
  // preview. A completed lasso ends in a browser click — the ref below lets
  // handleClick swallow that click so it doesn't also select an object
  // underneath the release point.
  const lassoPathRef = useRef<LassoPoint[] | null>(null);
  const [lassoDraft, setLassoDraft] = useState<LassoPoint[] | null>(null);
  const lassoJustFinishedRef = useRef(false);

  const cancelLasso = useCallback(() => {
    lassoPathRef.current = null;
    setLassoDraft(null);
  }, []);

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
      { points: c.points, mask: c.mask, label: c.label, origin: c.origin, paths: c.paths },
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
    label: 'Copy',
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
        const res = copyObjectToImageNode(g.maskId, imageNodeId);
        if (res) reposition(res.imageNodeId);
        return;
      }
      // Live selection: materialize + extract (the new node becomes active),
      // then reposition it to the drop and clear the selection.
      const c = candidate;
      if (!c?.mask || !sessionId) return;
      void runCandidateVerb(
        'copy-node',
        { points: c.points, mask: c.mask, label: c.label, origin: c.origin, paths: c.paths },
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
      if (lassoActive || magicActive) {
        // Lasso / magic-lasso freehand draw. Pointer capture keeps every move
        // on this element and away from React Flow.
        if (e.button !== 0) return;
        // Magic-lasso SAM-point refinement: shift over a live candidate appends
        // a SAM point via handleClick instead of drawing. Fall through.
        if (magicActive && e.shiftKey && candidate?.mask) return;
        // Draw-gate: the FIRST selection draws on a plain press. Once a
        // selection exists (a live candidate or any committed object), a plain
        // press is instead a point-select gesture — grab + drag-to-extract
        // (handled below) — and you hold Shift to draw the next (refine)
        // stroke. Mirrors the point tool: no-shift manipulates what's already
        // there, Shift makes something new.
        const hasSelection = !!candidate?.mask || existingObjects.length > 0;
        if (!hasSelection || e.shiftKey) {
          el.setPointerCapture(e.pointerId);
          lassoPathRef.current = [[nx, ny]];
          setLassoDraft([[nx, ny]]);
          return;
        }
        // hasSelection && !shift → fall through to extract-drag / select below.
      }
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
    [objectsMode, lassoActive, magicActive, candidate, existingObjects, extractDrag],
  );

  // Close the lasso: rasterize the polygon into a DecodedMask (pure scanline
  // fill — no SAM anywhere) and hand it to the same candidate state the SAM
  // path uses. Degenerate paths (accidental click, hairline scribble) are
  // discarded silently.
  const finishLasso = useCallback(() => {
    const path = lassoPathRef.current;
    lassoPathRef.current = null;
    setLassoDraft(null);
    if (!path) return;
    const { width, height } = lassoRasterSize(
      sourceWidth ?? widthPx, sourceHeight ?? heightPx,
    );
    const mask = rasterizeLassoPath(path, width, height);
    if (!mask) return;
    lassoJustFinishedRef.current = true;
    decodeSeqRef.current += 1; // invalidate any in-flight SAM decode
    setCandidate({
      points: [],
      mask,
      origin: 'client_lasso',
      paths: [path.map(([x, y]) => [x, y])],
    });
  }, [sourceWidth, sourceHeight, widthPx, heightPx]);

  // Close a magic lasso: feed the loop's bounding box to SAM as a box prompt so
  // it snaps to the one object inside. Falls back to the drawn polygon when SAM
  // is unavailable (backend-only capability) or returns a low-confidence mask —
  // so a stroke is never wasted. The SAM result carries the box-prompt points,
  // so shift-click refinement works exactly like the point tool.
  const finishMagicLasso = useCallback(async () => {
    const path = lassoPathRef.current;
    lassoPathRef.current = null;
    setLassoDraft(null);
    if (!path) return;
    const { width, height } = lassoRasterSize(
      sourceWidth ?? widthPx, sourceHeight ?? heightPx,
    );
    const polygonMask = rasterizeLassoPath(path, width, height);
    if (!polygonMask) return; // degenerate draw (accidental click) → no-op
    lassoJustFinishedRef.current = true;
    const pathCopy = path.map(([x, y]) => [x, y]);
    const bbox = bboxOfPath(path);
    const box = boxPrompt(bbox);
    const seq = ++decodeSeqRef.current;
    setCandidate({ points: box, mask: null }); // pending → "Segmenting…"
    const samMask = await samCapability.decode(box);
    if (seq !== decodeSeqRef.current) return; // superseded by a newer gesture
    if (samMask && isMaskAcceptable(samMask, bbox)) {
      // A clean SAM snap. Leave origin undefined so it commits as a normal SAM
      // selection ('client_new'); keep the drawn loop as attribution paths.
      setCandidate({ points: box, mask: samMask, paths: [pathCopy] });
    } else {
      // No confident object → fall back to the drawn polygon (plain-lasso result).
      setCandidate({ points: [], mask: polygonMask, origin: 'client_lasso', paths: [pathCopy] });
    }
  }, [sourceWidth, sourceHeight, widthPx, heightPx, samCapability]);

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

  // Esc mid-draw abandons the lasso path without producing a candidate.
  useEffect(() => {
    if (!lassoDraft) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelLasso(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lassoDraft, cancelLasso]);

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
        origin?: 'client_refinement' | 'client_new' | 'client_extracted' | 'client_lasso';
        paths?: [number, number][][];
      }>).detail;
      if (!detail || detail.imageNodeId !== imageNodeId) return;
      decodeSeqRef.current += 1; // invalidate any in-flight SAM decode
      setCandidate({
        points: [],
        mask: detail.mask,
        label: detail.label,
        origin: detail.origin,
        paths: detail.paths,
      });
    };
    window.addEventListener('segment-hit:external-candidate', handler);
    return () => window.removeEventListener('segment-hit:external-candidate', handler);
  }, [imageNodeId]);

  const runDecode = useCallback(async (points: SamPoint[]) => {
    // A decode is already running — ignore the click until its result lands.
    if (decodingRef.current) return;
    decodingRef.current = true;
    const seq = ++decodeSeqRef.current;
    setCandidate({ points, mask: null });
    try {
      const mask = await samCapability.decode(points);
      if (seq !== decodeSeqRef.current) return; // superseded by a newer gesture
      setCandidate({ points, mask });
    } finally {
      decodingRef.current = false;
    }
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
      // this handler and would recurse infinitely. By the time it re-enters
      // here Radix has already opened the menu at the target (target phase),
      // so the event's job is done — STOP it. Without stopPropagation it
      // keeps bubbling into the image-node's ContextMenu.Trigger wrapping
      // this layer, which stacks the node's menu on top of the candidate
      // menu and swallows the user's first click.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-candidate-trigger], [data-object-id]')) {
        e.stopPropagation();
        return;
      }
      const [nx, ny] = clientToNormalised(e, el);

      if (candidate?.mask && isInsideMask(nx, ny, candidate.mask)) {
        e.preventDefault();
        e.stopPropagation();
        const trig = el.querySelector('[data-candidate-trigger]') as HTMLElement | null;
        if (!trig) return;
        trig.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true,
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
        bubbles: true, cancelable: true,
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
      // Drawing a lasso: accumulate vertices (≈2-screen-px min distance so
      // the path stays light) and skip the hover hit-test entirely.
      const path = lassoPathRef.current;
      if (path) {
        const rect = el.getBoundingClientRect();
        const minDistNorm = rect.width > 0 ? 2 / rect.width : 0.002;
        if (shouldAppendPoint(path, [nx, ny], minDistNorm)) {
          path.push([nx, ny]);
          setLassoDraft([...path]);
        }
        setCursorTip(null); // drawing a lasso — no hover tooltip
        return;
      }
      const hit = existingObjects.find((obj) => {
        const x = Math.min(obj.mask.width - 1, Math.max(0, Math.floor(nx * obj.mask.width)));
        const y = Math.min(obj.mask.height - 1, Math.max(0, Math.floor(ny * obj.mask.height)));
        return obj.mask.data[y * obj.mask.width + x] === 255;
      });
      const hitId = hit?.id ?? null;
      setHoveringObject((prev) => (prev === (hitId !== null) ? prev : hitId !== null));
      // Cursor tooltip follows the pointer while over an object's pixels.
      if (hitId !== null) {
        const rect = el.getBoundingClientRect();
        setCursorTip({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setCursorTip((prev) => (prev === null ? prev : null));
      }
      // Bidirectional object hover: sync the shared `hoveredObjectId` so the
      // region's margin marker lights up (ObjectMarkers) and its mask overlay
      // paints (paintOverlays). Guarded to write only on enter/leave of an
      // object, not on every pointer move.
      const editor = useEditorStore.getState();
      if (editor.hoveredObjectId !== hitId) editor.setHoveredObjectId(hitId);
    },
    [existingObjects],
  );
  const handlePointerLeave = useCallback(() => {
    setHoveringObject(false);
    setCursorTip(null);
    const editor = useEditorStore.getState();
    if (editor.hoveredObjectId !== null) editor.setHoveredObjectId(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // A completed extract-drag or lasso ends in a click; swallow it so we
      // don't also select/pick at the release point.
      if (extractDrag.consumeDragClick()) return;
      if (lassoJustFinishedRef.current) {
        lassoJustFinishedRef.current = false;
        return;
      }
      const el = layerRef.current;
      if (!el) return;
      const [nx, ny] = clientToNormalised(e, el);

      // SHIFT+click with a live candidate = refinement, and it OUTRANKS the
      // committed-object hit-test below — the region being refined routinely
      // overlaps existing objects' pixels, and object-select was eating the
      // refine clicks (magic lasso felt dead). Positive point (label 1)
      // outside the current mask, negative (label 0) inside — the SAM
      // convention. Candidates without prompt points (plain-lasso polygon,
      // incl. the magic-lasso low-confidence fallback) refine too: the box
      // prompt is synthesized from the drawn loop, exactly like
      // finishMagicLasso does for a fresh draw.
      if (objectsMode && !lassoActive && e.shiftKey && candidate?.mask) {
        const insideMask = isInsideMask(nx, ny, candidate.mask);
        const point: SamPoint = { x: nx, y: ny, label: insideMask ? 0 : 1 };
        const basePoints = candidate.points.length > 0
          ? candidate.points
          : candidate.paths?.[0]
            ? boxPrompt(bboxOfPath(candidate.paths[0] as [number, number][]))
            : [];
        void runDecode([...basePoints, point]);
        return;
      }

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

      // Lasso tool: clicks never reach SAM — selection happens by drawing
      // (pointer down/move/up), and a degenerate draw already resolved to a
      // plain click above (object select) or nothing.
      if (lassoActive) return;

      // Shift-refine already handled above (it must outrank object select).

      // Magic lasso: fresh selection happens by drawing a loop, not by a plain
      // click. Only the shift-refine path above applies to clicks.
      if (magicActive) return;

      // Plain click (or shift without a candidate): start a fresh candidate.
      void runDecode([{ x: nx, y: ny, label: 1 }]);
    },
    [candidate, runDecode, existingObjects, imageNodeId, objectsMode, lassoActive, magicActive, extractDrag],
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
      onPointerUp={(e) => {
        if (lassoPathRef.current) {
          if (magicActive) { void finishMagicLasso(); } else { finishLasso(); }
          return;
        }
        extractDrag.onPointerUp(e);
      }}
      onPointerCancel={cancelLasso}
      onPointerLeave={handlePointerLeave}
    >
      {extractDrag.ghost}
      <SegmentMaskPreview
        mask={candidate?.mask ?? null}
        widthPx={widthPx}
        heightPx={heightPx}
      />
      {/* Live lasso path while drawing. viewBox 0..1 maps normalized vertices
       *  straight onto the layer; non-scaling-stroke keeps the dash hairline
       *  at every zoom. Tokens only — no hardcoded colors. */}
      {/* Cursor-following name tooltip — the object's only name surface on
          the photo (the persistent tag was removed; markers are dot-only).
          Chrome floating over photo content → frosted glass-overlay. */}
      {cursorTip && hoveredLabel && !lassoDraft && (
        <div
          data-testid="object-hover-tooltip"
          className="glass-overlay pointer-events-none absolute px-1.5 py-1 rounded-[4px] text-text-primary text-[10px] leading-none whitespace-nowrap z-20"
          style={{ left: `${cursorTip.x + 12}px`, top: `${cursorTip.y + 14}px` }}
        >
          {hoveredLabel}
        </div>
      )}
      {lassoDraft && lassoDraft.length >= 2 && (
        <svg
          data-testid="lasso-draft-path"
          className="pointer-events-none absolute inset-0 w-full h-full"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <polygon
            points={lassoDraft.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="var(--color-accent)"
            fillOpacity={0.12}
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      {lassoDraft && (
        <div
          data-testid="lasso-draft-hint"
          className="glass-overlay pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] text-text-primary text-[10px] leading-none whitespace-nowrap flex items-center gap-1.5"
        >
          <span>{magicActive ? 'release to snap' : 'release to close'}</span>
          <span className="opacity-40">·</span>
          <Kbd keys="esc" className="ml-0" />
          <span>cancel</span>
        </div>
      )}
      {candidate && !lassoDraft && (
        <div
          data-testid="segment-candidate-hint"
          data-state={candidate.mask ? 'ready' : 'pending'}
          className="glass-overlay pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-[4px] text-text-primary text-[10px] leading-none whitespace-nowrap flex items-center gap-1.5"
        >
          {candidate.mask ? (
            <>
              {/* With a live selection, a plain press drags-to-extract; Shift
                  draws the next refine stroke (lasso) or adds a SAM point
                  (magic). */}
              <Kbd keys="shift" className="ml-0" />
              <span>{magicActive ? '+ click refine' : '+ draw refine'}</span>
              <span className="opacity-40">·</span>
              <Kbd keys="esc" className="ml-0" />
              <span>discard</span>
            </>
          ) : (
            <>
              <Loader2 size={11} className="animate-spin text-[var(--color-ai)]" aria-hidden />
              <span>Segmenting…</span>
            </>
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
            <ContextMenu.Content
              className="overlay p-1 min-w-[180px] z-50"
              // Event boundary. The content lives in a body portal, but React
              // propagates its events through the REACT tree — i.e. straight
              // back into this hit layer's gesture handlers. Without these
              // stops, pressing a menu item starts a lasso draw (or arms
              // drag-to-extract) THROUGH the open menu.
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('keep')}
              >
                Keep as object
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('copy-layer')}
              >
                Copy to new layer
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('copy-node')}
              >
                Copy to image node
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none data-[disabled]:opacity-40 data-[disabled]:cursor-default"
                disabled={!sessionId}
                onSelect={() => void runVerb('genfill')}
              >
                Generative fill…
              </ContextMenu.Item>
              <ContextMenu.Item
                className="text-[12px] px-2 py-1.5 rounded-[3px] hover:bg-surface-secondary cursor-pointer outline-none"
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
