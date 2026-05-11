import { z } from 'zod';
import type { ImageContext } from '@/types/image-context';

const CandidateRegionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export const ImageContextSchema = z
  .object({
    subjects: z.array(z.string()).default([]),
    lighting: z.enum(['flat', 'backlit', 'side', 'rim', 'mixed']),
    dominant_tones: z.array(z.enum(['shadows', 'midtones', 'highlights'])).default([]),
    mood: z.string(),
    candidate_regions: z.array(CandidateRegionSchema).default([]),
    model_name: z.string(),
    model_version: z.string(),
    generated_at: z.string(),
  })
  .transform<ImageContext>((c) => ({
    subjects: c.subjects,
    lighting: c.lighting,
    dominantTones: c.dominant_tones,
    mood: c.mood,
    candidateRegions: c.candidate_regions,
    modelName: c.model_name,
    modelVersion: c.model_version,
    generatedAt: c.generated_at,
  }));
