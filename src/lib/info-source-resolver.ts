/**
 * Resolves `InfoPinnedItem.sourceId` → current live value.
 *
 * Pinned info widgets live-mirror their source (mechanical histogram,
 * document meta, EXIF) rather than freezing the value at pin time. This
 * module centralises the resolution so adding a new chip type is one
 * `case` rather than a render-tree spelunk.
 *
 * Resolvers are pure functions of (mech, documentMeta) → string | undefined.
 * Returning `undefined` means "live source unavailable" — the caller should
 * fall back to the stored snapshot value.
 */

import type { MechanicalSnapshot } from './mechanical-context';
import type { DocumentMeta } from '@/core/types';
import {
  formatAperture,
  formatAspectRatio,
  formatCapturedAt,
  formatExposureBias,
  formatFileSize,
  formatFocalLength,
  formatFormatTag,
  formatIso,
  formatMegapixels,
  formatResolution,
  formatShutter,
} from './image-metadata';

export interface LiveSources {
  mech: MechanicalSnapshot | null;
  documentMeta: DocumentMeta | null;
}

/** Resolve a sourceId to its current pre-formatted string value. Returns
 *  undefined when the source is unavailable so callers can fall back to a
 *  stored snapshot. */
export function resolveSourceValue(sourceId: string, src: LiveSources): string | undefined {
  const { mech, documentMeta } = src;
  switch (sourceId) {
    // ─── Mechanical (live histogram + palette + cast) ──────────────
    case 'mech:median_luma':
      return mech ? mech.median_luma.toFixed(0) : undefined;
    case 'mech:contrast_p10_p90':
      return mech ? mech.contrast_p10_p90.toFixed(0) : undefined;
    case 'mech:clipped_shadows':
      return mech ? `${mech.clipped_shadows_pct.toFixed(1)}%` : undefined;
    case 'mech:clipped_highlights':
      return mech ? `${mech.clipped_highlights_pct.toFixed(1)}%` : undefined;
    case 'mech:cast_strength':
      return mech ? `${(mech.cast_strength * 100).toFixed(0)}%` : undefined;

    // ─── Document (width × height derived) ─────────────────────────
    case 'doc:resolution':
      return documentMeta ? formatResolution(documentMeta.width, documentMeta.height) : undefined;
    case 'doc:aspect':
      return documentMeta ? formatAspectRatio(documentMeta.width, documentMeta.height) : undefined;
    case 'doc:megapixels':
      return documentMeta ? formatMegapixels(documentMeta.width, documentMeta.height) : undefined;

    // ─── File ──────────────────────────────────────────────────────
    case 'file:format':
      return documentMeta ? formatFormatTag(documentMeta.mimeType) : undefined;
    case 'file:size':
      return documentMeta ? formatFileSize(documentMeta.fileSize) : undefined;

    // ─── EXIF (read from the parsed metadata) ──────────────────────
    case 'exif:camera': {
      const m = documentMeta?.metadata;
      if (!m) return undefined;
      const parts = [m.cameraMake, m.cameraModel].filter((s): s is string => !!s);
      return parts.length > 0 ? parts.join(' ') : undefined;
    }
    case 'exif:lens':
      return documentMeta?.metadata?.lensModel;
    case 'exif:focal':
      return formatFocalLength(documentMeta?.metadata?.focalLengthMm);
    case 'exif:aperture':
      return formatAperture(documentMeta?.metadata?.aperture);
    case 'exif:shutter':
      return formatShutter(documentMeta?.metadata?.shutterSeconds);
    case 'exif:iso':
      return formatIso(documentMeta?.metadata?.iso);
    case 'exif:bias':
      return formatExposureBias(documentMeta?.metadata?.exposureBiasEv);
    case 'exif:captured_at':
      return formatCapturedAt(documentMeta?.metadata?.capturedAt);

    default:
      return undefined;
  }
}
