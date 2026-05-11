export type Lighting = 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
export type DominantTone = 'shadows' | 'midtones' | 'highlights';

export interface CandidateRegion {
  label: string;
  description: string;
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
