import { z } from 'zod';
import type { ImageContext } from '@/types/image-context';

const CandidateRegionSchema = z
  .object({
    label: z.string(),
    description: z.string(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullish(),
    representative_point: z.tuple([z.number(), z.number()]).nullish(),
  })
  .transform((r) => ({
    label: r.label,
    description: r.description,
    bbox: (r.bbox ?? undefined) as [number, number, number, number] | undefined,
    representativePoint: (r.representative_point ?? undefined) as [number, number] | undefined,
  }));

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
