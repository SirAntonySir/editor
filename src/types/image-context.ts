export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

/** One polygon in normalised (0–1) image coordinates. */
export type RegionPolygon = [number, number][];

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
  subjects: string[];
  lighting: Lighting;
  dominantTones: DominantTone[];
  mood: string;
  candidateRegions: CandidateRegion[];
  modelName: string;
  modelVersion: string;
  generatedAt: string;
}
