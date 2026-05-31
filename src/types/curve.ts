/**
 * Curve value model — the structured value a curves op carries (control points
 * per channel). Lives in its own leaf module so both `widget.ts` and
 * `operation-graph.ts` can import it without a types cycle.
 */
export interface CurvePoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface CurvesValue {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

/** A fresh identity-curve value (straight line) for all four channels. */
export const IDENTITY_CURVES: CurvesValue = {
  rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  red: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
};
