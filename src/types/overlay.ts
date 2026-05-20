import type { MaskRef } from './scope';

/**
 * A single visual overlay anchored to a canvas layer (image). Every overlay
 * is materialized as a Fabric object whose transform mirrors the parent
 * layer's transform — pan, zoom, rotate, flip all come for free.
 *
 * New overlay kinds (`dots`, `bbox`, `text-label`, etc.) extend the union;
 * the renderer adds a case per kind. Style fields stay loose on purpose —
 * specific overlay kinds may need different style properties.
 */
export type OverlayLayer =
  | MaskOverlayLayer
  | OutlineOverlayLayer;

export interface MaskOverlayLayer {
  kind: 'mask';
  /** Stable id for diffing (typically the maskRef itself). */
  id: string;
  /** ID of the parent image layer whose transform this overlay tracks. */
  anchorTo: string;
  /** The mask whose pixel data fills the overlay. */
  maskRef: MaskRef;
  /** State flag — affects visual style (e.g. active uses fill, committed uses outline). */
  state: 'active' | 'committed';
  style?: {
    fillHsl?: [number, number, number];
    alpha?: number;
  };
}

export interface OutlineOverlayLayer {
  kind: 'outline';
  id: string;
  anchorTo: string;
  maskRef: MaskRef;
  style?: {
    strokeHsl?: [number, number, number];
    dashed?: boolean;
  };
}
