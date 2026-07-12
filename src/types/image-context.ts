export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

/** One polygon in normalised (0–1) image coordinates. */
export type RegionPolygon = [number, number][];

export interface ColorSwatchData {
  rgb: [number, number, number];
  weight: number;
}

export type ProblemKind =
  // Whole-image defects (regionLabel/bbox usually null)
  | 'clipped_highlights'
  | 'crushed_shadows'
  | 'low_contrast'
  | 'strong_color_cast'
  | 'noisy_shadows'
  | 'uneven_white_balance'
  // Element-local defects — carry regionLabel + bbox of the candidate region
  | 'local_underexposure'
  | 'local_overexposure'
  | 'soft_focus'
  | 'distracting_element'
  | 'dull_subject'
  | 'skin_tone_shift';

export interface Problem {
  kind: ProblemKind;
  severity: number;
  regionLabel?: string | null;
  bbox?: [number, number, number, number] | null;
  /** Registry op ids the analyzer recommends for this problem (e.g. ["light", "color"]). */
  suggestedOps: string[];
  /** @deprecated Legacy template ids — kept so persisted sessions deserialize. Nothing writes this anymore. */
  suggestedFusedTools: string[];
}

export interface RegionStats {
  label: string;
  pixelCount: number;
  meanLuma: number;
  lumaHistogram: number[];
  meanRgb: [number, number, number];
  dominantSwatches: ColorSwatchData[];
  isSkinLikely: boolean;
  isSkyLikely: boolean;
  saturationMean: number;
  contrastP10P90: number;
}

export interface CandidateRegion {
  label: string;
  description: string;
  /** Normalised 0–1 axis-aligned bbox: [x, y, width, height]. */
  bbox?: [number, number, number, number];
  /** Normalised 0–1 click target inside the region: [x, y]. */
  representativePoint?: [number, number];
  /**
   * SAM-derived polygon paths in normalised 0–1 image coordinates.
   * Multiple polygons represent disjoint components of the mask.
   * Set by the backend `/api/analyze` pass; absence means SAM didn't find
   * a usable segment for this region. Used by the preview canvas to render
   * the colored overlay.
   */
  paths?: RegionPolygon[];
  /**
   * Raw SAM mask as a base64-encoded PNG (1-channel, 0/255). Preferred
   * source when registering the mask into `maskStore` — pixel-accurate, no
   * polygon roundtrip. Falls back to rasterising `paths` when absent
   * (older cached contexts).
   */
  maskPngBase64?: string;
  /** Frontend-only ref into maskStore; set after lazily registering the mask. */
  maskRef?: string;
}

export interface ImageContext {
  // Base context fields
  subjects: string[];
  lighting: Lighting;
  dominantTones: DominantTone[];
  mood: string;
  candidateRegions: CandidateRegion[];
  modelName: string;
  modelVersion: string;
  generatedAt: string;

  // Enriched fields (mechanical pass + Claude-augmented)
  lumaHistogram?: number[];
  rgbHistograms?: Record<string, number[]>;
  clippedShadowsPct?: number;
  clippedHighlightsPct?: number;
  medianLuma?: number;
  contrastP10P90?: number;
  colorPalette?: ColorSwatchData[];
  castStrength?: number;
  castDirection?: [number, number];
  regionStats?: RegionStats[];
  estimatedWhitePoint?: [number, number, number];
  wbNeutralConfidence?: number;
  gradeCharacter?: string;
  problems?: Problem[];
}
