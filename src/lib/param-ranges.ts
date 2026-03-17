/**
 * Centralized parameter range definitions for all adjustment node types.
 * Used by NodeScrubber for drag scaling and double-click reset.
 */

export interface ParamRange {
  min: number;
  max: number;
  default: number;
  step?: number;
  format?: (v: number) => string;
}

const degreeFormat = (v: number) => `${Math.round(v)}°`;
const kelvinFormat = (v: number) => `${Math.round(v)}K`;
const gammaFormat = (v: number) => v.toFixed(2);

export const PARAM_RANGES: Record<string, Record<string, ParamRange>> = {
  light: {
    exposure:   { min: -100, max: 100, default: 0 },
    brightness: { min: -100, max: 100, default: 0 },
    contrast:   { min: -100, max: 100, default: 0 },
    highlights: { min: -100, max: 100, default: 0 },
    shadows:    { min: -100, max: 100, default: 0 },
  },
  color: {
    saturation: { min: -100, max: 100, default: 0 },
    vibrance:   { min: -100, max: 100, default: 0 },
    hue:        { min: 0, max: 360, default: 0, format: degreeFormat },
  },
  kelvin: {
    kelvin: { min: 2000, max: 12000, default: 6500, format: kelvinFormat },
    tint:   { min: -100, max: 100, default: 0 },
  },
  levels: {
    inBlack:  { min: 0, max: 255, default: 0 },
    inWhite:  { min: 0, max: 255, default: 255 },
    gamma:    { min: 0.1, max: 10, default: 1.0, step: 0.01, format: gammaFormat },
    outBlack: { min: 0, max: 255, default: 0 },
    outWhite: { min: 0, max: 255, default: 255 },
  },
};

/** Get the range for a param, falling back to a sensible default */
export function getParamRange(nodeType: string, paramKey: string): ParamRange {
  return PARAM_RANGES[nodeType]?.[paramKey] ?? { min: -100, max: 100, default: 0 };
}
