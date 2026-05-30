// Frontend mirror of the backend's EnrichedImageContext, narrowed from the
// snapshot's `image_context` payload. The backend has no camelCase alias
// generator, so the wire shape is snake_case — this interface mirrors that
// shape exactly (it deliberately does NOT extend the camelCase frontend
// `ImageContext`). `useImageContextFull` casts the raw payload to this type.

export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

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

/** Candidate region as delivered in the snapshot's image_context (snake_case). */
export interface EnrichedCandidateRegion {
  label: string;
  description: string;
  bbox?: [number, number, number, number] | null;
  representative_point?: [number, number] | null;
  paths?: [number, number][][] | null;
  mask_png_base64?: string | null;
}

export interface EnrichedImageContext {
  // Base context (snake_case, as serialized by the backend)
  subjects: string[];
  lighting: Lighting;
  dominant_tones: DominantTone[];
  mood: string;
  candidate_regions: EnrichedCandidateRegion[];
  model_name: string;
  model_version: string;
  generated_at: string;

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
