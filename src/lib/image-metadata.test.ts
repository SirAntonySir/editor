import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatAperture,
  formatAspectRatio,
  formatCapturedAt,
  formatCoordinates,
  formatExposureBias,
  formatFileSize,
  formatFocalLength,
  formatFormatTag,
  formatIso,
  formatMegapixels,
  formatResolution,
  formatShutter,
  mapsUrlFor,
  parseImageMetadata,
} from './image-metadata';

// Stub exifr so unit tests are deterministic and don't try to fetch the
// real EXIF parser (which expects a Blob with image bytes).
vi.mock('exifr', () => ({
  default: {
    parse: vi.fn(),
  },
}));

import exifr from 'exifr';
const parseMock = (exifr as unknown as { parse: ReturnType<typeof vi.fn> }).parse;

describe('format helpers', () => {
  it('formatFocalLength rounds to mm', () => {
    expect(formatFocalLength(35.2)).toBe('35 mm');
    expect(formatFocalLength(undefined)).toBeUndefined();
  });

  it('formatAperture uses one decimal under f/10', () => {
    expect(formatAperture(1.4)).toBe('f/1.4');
    expect(formatAperture(11)).toBe('f/11');
  });

  it('formatShutter renders fast shutters as fractions, slow as seconds', () => {
    expect(formatShutter(1 / 250)).toBe('1/250 s');
    expect(formatShutter(2)).toBe('2.0 s');
    expect(formatShutter(undefined)).toBeUndefined();
  });

  it('formatIso prefixes "ISO"', () => {
    expect(formatIso(800)).toBe('ISO 800');
  });

  it('formatExposureBias omits near-zero bias', () => {
    expect(formatExposureBias(0.005)).toBeUndefined();
    expect(formatExposureBias(0.7)).toBe('+0.7 EV');
    expect(formatExposureBias(-1)).toBe('−1.0 EV');
  });

  it('formatCapturedAt produces a readable string', () => {
    const out = formatCapturedAt(Date.UTC(2024, 5, 1, 12, 30));
    expect(typeof out).toBe('string');
    expect(out!.length).toBeGreaterThan(5);
  });

  it('formatCoordinates uses N/S, E/W suffixes', () => {
    expect(formatCoordinates(48.137, 11.575)).toBe('48.137°N, 11.575°E');
    expect(formatCoordinates(-22.9, -43.2)).toBe('22.900°S, 43.200°W');
  });

  it('mapsUrlFor renders an openstreetmap link', () => {
    expect(mapsUrlFor(48.13, 11.57)).toContain('openstreetmap.org');
    expect(mapsUrlFor(48.13, 11.57)).toContain('48.13');
  });
});

describe('document-level helpers', () => {
  it('formatResolution renders w × h with the unicode times sign', () => {
    expect(formatResolution(3024, 4032)).toBe('3024 × 4032');
    expect(formatResolution(0, 100)).toBeUndefined();
    expect(formatResolution(undefined, 100)).toBeUndefined();
  });

  it('formatAspectRatio simplifies common ratios', () => {
    expect(formatAspectRatio(3024, 4032)).toBe('3:4');
    expect(formatAspectRatio(1920, 1080)).toBe('16:9');
    expect(formatAspectRatio(1000, 1000)).toBe('1:1');
  });

  it('formatAspectRatio falls back to a decimal when the GCD is unfriendly', () => {
    // 17:11 has no small factor — but is still small enough for the simple
    // branch. Pick a deliberately ugly width/height instead.
    const out = formatAspectRatio(2049, 1031)!;
    expect(out).toMatch(/:1|1:/);
  });

  it('formatMegapixels rounds proportionally', () => {
    expect(formatMegapixels(4000, 3000)).toBe('12 MP');
    expect(formatMegapixels(1000, 1000)).toBe('1.0 MP');
  });

  it('formatFormatTag derives short labels from MIME', () => {
    expect(formatFormatTag('image/jpeg')).toBe('JPEG');
    expect(formatFormatTag('image/heic')).toBe('HEIC');
    expect(formatFormatTag('image/png')).toBe('PNG');
    expect(formatFormatTag('image/svg+xml')).toBe('SVG');
    expect(formatFormatTag(undefined)).toBeUndefined();
  });

  it('formatFileSize picks an appropriate unit', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(4_200_000)).toBe('4.0 MB');
    expect(formatFileSize(undefined)).toBeUndefined();
    expect(formatFileSize(-1)).toBeUndefined();
  });
});

describe('parseImageMetadata', () => {
  beforeEach(() => parseMock.mockReset());

  it('returns null when exifr throws', async () => {
    parseMock.mockRejectedValueOnce(new Error('bad file'));
    expect(await parseImageMetadata(new Blob())).toBeNull();
  });

  it('returns null when no fields of interest are present', async () => {
    parseMock.mockResolvedValueOnce({ irrelevantField: 'whatever' });
    expect(await parseImageMetadata(new Blob())).toBeNull();
  });

  it('projects a curated subset and coerces numeric strings', async () => {
    parseMock.mockResolvedValueOnce({
      Make: ' FUJIFILM ',
      Model: 'X-T4',
      LensModel: 'XF35mmF1.4 R',
      FocalLength: '35',
      FNumber: 1.4,
      ExposureTime: 0.004,
      ISO: 800,
      ExposureBiasValue: -0.7,
      DateTimeOriginal: new Date(Date.UTC(2024, 0, 1, 8, 0)),
      latitude: 48.137,
      longitude: 11.575,
      GPSAltitude: 520,
    });
    const m = await parseImageMetadata(new Blob());
    expect(m).not.toBeNull();
    expect(m!.cameraMake).toBe('FUJIFILM');
    expect(m!.cameraModel).toBe('X-T4');
    expect(m!.lensModel).toBe('XF35mmF1.4 R');
    expect(m!.focalLengthMm).toBe(35);
    expect(m!.aperture).toBeCloseTo(1.4);
    expect(m!.shutterSeconds).toBeCloseTo(0.004);
    expect(m!.iso).toBe(800);
    expect(m!.exposureBiasEv).toBeCloseTo(-0.7);
    expect(m!.capturedAt).toBe(Date.UTC(2024, 0, 1, 8, 0));
    expect(m!.latitude).toBe(48.137);
    expect(m!.longitude).toBe(11.575);
    expect(m!.altitudeMeters).toBe(520);
  });
});
