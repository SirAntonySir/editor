import type { ImageContext } from '@/types/image-context';

export function makeFullContext(): ImageContext {
  return {
    // base context (camelCase)
    subjects: ['train station platform at night', 'black locomotive'],
    lighting: 'mixed',
    dominantTones: ['shadows', 'midtones'],
    mood: 'quiet, moody, nocturnal',
    candidateRegions: [
      { label: 'sky', description: 'overcast night sky', bbox: [0, 0, 1, 0.3] },
      { label: 'locomotive', description: 'black engine, foreground', bbox: [0.2, 0.4, 0.5, 0.5] },
    ],
    modelName: 'claude',
    modelVersion: 'sonnet-4.5',
    generatedAt: '2026-05-29T00:00:00Z',
    // mechanical
    lumaHistogram: Array.from({ length: 256 }, (_, i) => Math.round(Math.sin(i / 20) * 50 + 60)),
    rgbHistograms: {
      r: Array.from({ length: 256 }, (_, i) => 30 + (i % 17)),
      g: Array.from({ length: 256 }, (_, i) => 40 + (i % 13)),
      b: Array.from({ length: 256 }, (_, i) => 50 + (i % 11)),
    },
    clippedShadowsPct: 2.5,
    clippedHighlightsPct: 0.7,
    medianLuma: 0.42,
    contrastP10P90: 0.31,
    colorPalette: [
      { rgb: [20, 22, 30], weight: 0.45 },
      { rgb: [120, 90, 60], weight: 0.25 },
      { rgb: [200, 60, 60], weight: 0.18 },
      { rgb: [220, 220, 230], weight: 0.12 },
    ],
    castStrength: 0.35,
    castDirection: [12, -8],
    regionStats: [],
    // Claude-augmented
    estimatedWhitePoint: [248, 244, 240],
    wbNeutralConfidence: 0.78,
    gradeCharacter: 'cool teal-orange',
    problems: [
      { kind: 'crushed_shadows', severity: 0.6, regionLabel: 'foreground', suggestedOps: ['light', 'levels'], suggestedFusedTools: [] },
    ],
  };
}

export function makePartialContext(): ImageContext {
  // Mechanical pass done, Claude pass not yet.
  const full = makeFullContext();
  return {
    ...full,
    gradeCharacter: 'neutral',
    problems: [],
  };
}
