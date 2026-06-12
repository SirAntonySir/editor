// Re-export of generated runtime constants. Single source of truth lives in
// backend/app/config/runtime.py — refresh via `npm run gen:types`.
//
// Use this module to import timing values, limits, and LLM budgets:
//   import { RUNTIME } from '@/config/runtime';
//   setTimeout(fn, RUNTIME.sliderDebounceMs);

export { RUNTIME } from '@shared/types/generated-config';
export type { RUNTIMEType as RuntimeConfig } from '@shared/types/generated-config';
