/**
 * Centralized parameter range definitions for all adjustment node types.
 * Delegates to the ProcessingRegistry when available, with hardcoded fallbacks.
 */
import { ProcessingRegistry } from '@/lib/processing-registry';

export interface ParamRange {
  min: number;
  max: number;
  default: number;
  step?: number;
  format?: (v: number) => string;
}

/** Get the range for a param, resolved from the ProcessingRegistry. */
export function getParamRange(nodeType: string, paramKey: string): ParamRange {
  const def = ProcessingRegistry.getParamRange(nodeType, paramKey);
  if (def) {
    return {
      min: def.min,
      max: def.max,
      default: def.default,
      step: def.step,
      format: def.format,
    };
  }
  // Fallback for unregistered types
  return { min: -100, max: 100, default: 0 };
}
