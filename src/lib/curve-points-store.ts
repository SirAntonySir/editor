/**
 * Shared store for curve control points, keyed by layerId.
 *
 * Both CurvesPanel (develop tab) and InlineCurvesEditor (graph node)
 * read and write here so edits in either location stay in sync.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_CURVE_POINTS, type CurvePoint } from '@/lib/curves';

type Channel = 'rgb' | 'red' | 'green' | 'blue';
export type CurvePointsMap = Record<Channel, CurvePoint[]>;

function makeDefault(): CurvePointsMap {
  return {
    rgb: [...DEFAULT_CURVE_POINTS],
    red: [...DEFAULT_CURVE_POINTS],
    green: [...DEFAULT_CURVE_POINTS],
    blue: [...DEFAULT_CURVE_POINTS],
  };
}

// ─── Module-level state ──────────────────────────────────────────────
const store = new Map<string, CurvePointsMap>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/**
 * Get curve points for a layer.
 * Lazily creates and caches a default entry so the same reference
 * is returned on every call (required by useSyncExternalStore).
 */
export function getCurvePoints(layerId: string): CurvePointsMap {
  let entry = store.get(layerId);
  if (!entry) {
    entry = makeDefault();
    store.set(layerId, entry);
  }
  return entry;
}

/** Set curve points for a layer and notify subscribers */
export function setCurvePoints(layerId: string, points: CurvePointsMap) {
  store.set(layerId, points);
  notify();
}

/** Clear stored points for a layer */
export function clearCurvePoints(layerId: string) {
  store.delete(layerId);
  notify();
}

// ─── Serialization helpers ────────────────────────────────────────────

type SerializedCurvePoints = Record<string, number[]>;

/** Export all non-default curve points as serializable data. */
export function exportAllCurvePoints(): Record<string, SerializedCurvePoints> {
  const result: Record<string, SerializedCurvePoints> = {};
  for (const [layerId, points] of store) {
    const serialized: SerializedCurvePoints = {};
    for (const ch of ['rgb', 'red', 'green', 'blue'] as Channel[]) {
      // Flatten [{x,y}, ...] → [x1,y1,x2,y2,...]
      const flat: number[] = [];
      for (const p of points[ch]) {
        flat.push(p.x, p.y);
      }
      serialized[ch] = flat;
    }
    result[layerId] = serialized;
  }
  return result;
}

/** Import curve points from serialized data. */
export function importAllCurvePoints(data: Record<string, SerializedCurvePoints>): void {
  for (const [layerId, serialized] of Object.entries(data)) {
    const points = makeDefault();
    for (const ch of ['rgb', 'red', 'green', 'blue'] as Channel[]) {
      const flat = serialized[ch];
      if (!flat || flat.length < 4) continue;
      const pts: CurvePoint[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        pts.push({ x: flat[i], y: flat[i + 1] });
      }
      points[ch] = pts;
    }
    store.set(layerId, points);
  }
  notify();
}

// ─── React hook ──────────────────────────────────────────────────────

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Subscribe to curve points for a specific layer */
export function useCurvePoints(layerId: string): [CurvePointsMap, (pts: CurvePointsMap) => void] {
  const points = useSyncExternalStore(
    subscribe,
    () => getCurvePoints(layerId),
  );

  const setPoints = useCallback(
    (pts: CurvePointsMap) => setCurvePoints(layerId, pts),
    [layerId],
  );

  return [points, setPoints];
}
