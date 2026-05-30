import type { EnrichedImageContext } from '@/types/enriched-context';

export function makeFullContext(): EnrichedImageContext {
  return {
    // base context (snake_case, matching the backend wire shape)
    subjects: ['train station platform at night', 'black locomotive'],
    lighting: 'mixed',
    dominant_tones: ['shadows', 'midtones'],
    mood: 'quiet, moody, nocturnal',
    candidate_regions: [
      { label: 'sky', description: 'overcast night sky', bbox: [0, 0, 1, 0.3] },
      { label: 'locomotive', description: 'black engine, foreground', bbox: [0.2, 0.4, 0.5, 0.5] },
    ],
    model_name: 'claude',
    model_version: 'sonnet-4.5',
    generated_at: '2026-05-29T00:00:00Z',
    // mechanical
    luma_histogram: Array.from({ length: 256 }, (_, i) => Math.round(Math.sin(i / 20) * 50 + 60)),
    rgb_histograms: {
      r: Array.from({ length: 256 }, (_, i) => 30 + (i % 17)),
      g: Array.from({ length: 256 }, (_, i) => 40 + (i % 13)),
      b: Array.from({ length: 256 }, (_, i) => 50 + (i % 11)),
    },
    clipped_shadows_pct: 2.5,
    clipped_highlights_pct: 0.7,
    median_luma: 0.42,
    contrast_p10_p90: 0.31,
    color_palette: [
      { rgb: [20, 22, 30], weight: 0.45 },
      { rgb: [120, 90, 60], weight: 0.25 },
      { rgb: [200, 60, 60], weight: 0.18 },
      { rgb: [220, 220, 230], weight: 0.12 },
    ],
    cast_strength: 0.35,
    cast_direction: [12, -8],
    region_stats: [],
    // Claude-augmented
    estimated_white_point: [248, 244, 240],
    wb_neutral_confidence: 0.78,
    grade_character: 'cool teal-orange',
    problems: [
      { kind: 'crushed_shadows', severity: 0.6, region_label: 'foreground', suggested_fused_tools: ['shadows_lift'] },
    ],
  };
}

export function makePartialContext(): EnrichedImageContext {
  // Mechanical pass done, Claude pass not yet.
  const full = makeFullContext();
  return {
    ...full,
    grade_character: 'neutral',
    problems: [],
  };
}
