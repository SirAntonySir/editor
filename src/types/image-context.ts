export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

export interface CandidateRegion {
  label: string;
  description: string;
  /** Normalised 0–1 axis-aligned bbox: [x, y, width, height]. */
  bbox?: [number, number, number, number];
  /** Normalised 0–1 click target inside the region: [x, y]. */
  representativePoint?: [number, number];
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
