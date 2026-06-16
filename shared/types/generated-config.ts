// THIS FILE IS GENERATED — DO NOT EDIT BY HAND.
// Run `python scripts/gen-shared-types.py` (or `npm run gen:types`) to refresh.
// Source of truth: backend/app/config/runtime.py + backend/app/config/ui.py

/* eslint-disable */

/** Runtime constants — timings, limits, LLM budgets. Mirrors backend RuntimeConfig. */
export const RUNTIME = {
  sseReconnectBaseMs: 250,
  sseReconnectMaxMs: 4000,
  sseSafetyTimeoutMs: 1500,
  sliderDebounceMs: 300,
  toastDismissMs: 4000,
  statusHoldMs: 3000,
  historyMaxEntries: 100,
  undoMaxEntries: 100,
  checkpointIntervalS: 5,
  diskSessionMaxAgeS: 3600,
  diskPruneIntervalS: 600,
  historyCoalesceWindowMs: 2000,
  anthropicTimeoutS: 120.0,
  maxVisionDim: 1568,
  maxTokensAnalyze: 2048,
  maxTokensCompose: 1500,
  maxTokensRefine: 1024,
  maxTokensClassify: 512,
  maxTokensShort: 128,
} as const;
export type RUNTIMEType = typeof RUNTIME;

/** UI numeric tokens — z-index, motion, layout bounds. Mirrors backend UiConfig. */
export const UI = {
  zOverlay: 50,
  zPopover: 60,
  zModal: 70,
  zTooltip: 80,
  motionFastMs: 120,
  motionBaseMs: 200,
  motionSlowMs: 280,
  imageNodeDisplayWidthDefault: 600,
  imageNodeDisplayWidthMin: 120,
  imageNodeDisplayWidthMax: 4000,
  splitGapPx: 24,
  infoWidgetHistogramW: 320,
  infoWidgetHistogramH: 180,
  infoWidgetPaletteW: 320,
  infoWidgetPaletteH: 120,
  infoWidgetCastW: 220,
  infoWidgetCastH: 160,
  infoWidgetStatsW: 280,
  infoWidgetStatsH: 120,
} as const;
export type UIType = typeof UI;
