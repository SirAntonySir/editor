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
   * a usable segment for this region.
   */
  paths?: RegionPolygon[];
  /** Frontend-only ref into maskStore; set after lazily rasterising paths. */
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
