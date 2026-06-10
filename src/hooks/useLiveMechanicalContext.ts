/**
 * Tracks the active image node's composite canvas and derives a live
 * `MechanicalSnapshot` from it. The Info tab's mechanical sections
 * (Histograms + Color palette/cast) read from this hook so they update on
 * every edit rather than freezing on the upload-time analyze pass.
 *
 * Recomputes are coalesced through rAF — multiple publishes in the same
 * frame collapse to a single snapshot computation. The sample is fixed-
 * cost (256×256 down-sample inside `computeMechanicalSnapshot`), so even
 * during slider drags this stays inexpensive.
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '@/store';
import { activeCanvasBus } from '@/lib/active-canvas-bus';
import {
  computeMechanicalSnapshot,
  type MechanicalSnapshot,
} from '@/lib/mechanical-context';

export function useLiveMechanicalContext(): MechanicalSnapshot | null {
  const activeImageNodeId = useEditorStore((s) => s.activeImageNodeId);
  const [snapshot, setSnapshot] = useState<MechanicalSnapshot | null>(null);
  // Reset on id change via the official "previous-prop tracking" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect#resetting-all-state-when-a-prop-changes).
  // Keeps the reset synchronous with the id change without scheduling it
  // inside an effect.
  const [prevId, setPrevId] = useState(activeImageNodeId);
  if (prevId !== activeImageNodeId) {
    setPrevId(activeImageNodeId);
    setSnapshot(null);
  }

  useEffect(() => {
    if (!activeImageNodeId) return;
    let pendingCanvas: HTMLCanvasElement | null = null;
    let rafId: number | null = null;

    const flush = () => {
      rafId = null;
      const c = pendingCanvas;
      pendingCanvas = null;
      if (!c || c.width === 0 || c.height === 0) return;
      const next = computeMechanicalSnapshot(c);
      if (next) setSnapshot(next);
    };

    const unsub = activeCanvasBus.subscribe((imageNodeId, canvas) => {
      if (imageNodeId !== activeImageNodeId) return;
      pendingCanvas = canvas;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    });

    return () => {
      unsub();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [activeImageNodeId]);

  return snapshot;
}
