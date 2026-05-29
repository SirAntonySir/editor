import type { ImageContext } from './image-context';

export interface ColorSwatchData {
  rgb: [number, number, number];
  weight: number;
}

export type ProblemKind =
  | 'clipped_highlights'
  | 'crushed_shadows'
  | 'low_contrast'
  | 'strong_color_cast'
  | 'noisy_shadows'
  | 'uneven_white_balance';

export interface Problem {
  kind: ProblemKind;
  severity: number;
  region_label?: string | null;
  bbox?: [number, number, number, number] | null;
  suggested_fused_tools: string[];
}

export interface RegionStats {
  label: string;
  pixel_count: number;
  mean_luma: number;
  luma_histogram: number[];
  mean_rgb: [number, number, number];
  dominant_swatches: ColorSwatchData[];
  is_skin_likely: boolean;
  is_sky_likely: boolean;
  saturation_mean: number;
  contrast_p10_p90: number;
}

export interface EnrichedImageContext extends ImageContext {
  // Cheap mechanical pass
  luma_histogram: number[];
  rgb_histograms: { r?: number[]; g?: number[]; b?: number[] };
  clipped_shadows_pct: number;
  clipped_highlights_pct: number;
  median_luma: number;
  contrast_p10_p90: number;
  color_palette: ColorSwatchData[];
  cast_strength: number;
  cast_direction: [number, number];
  region_stats: RegionStats[];

  // Claude-augmented pass
  estimated_white_point: [number, number, number];
  wb_neutral_confidence: number;
  grade_character: string;
  problems: Problem[];
}
