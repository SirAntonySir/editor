/**
 * Curated EXIF / IPTC metadata extraction.
 *
 * Wraps `exifr.parse(file)` (already a project dep) and projects the
 * sprawling raw output down to a small, typed `ImageMetadata` object we
 * actually render in the Info tab. Fields are all optional — every renderer
 * downstream short-circuits on undefined, so we never have to invent
 * placeholder strings to keep layout stable.
 *
 * Goals:
 *  - Zero throws on malformed / missing EXIF. Returns `null` instead.
 *  - Pre-format numeric values (focal length, aperture, shutter, ISO) so
 *    the UI layer doesn't have to know about EXIF idioms.
 *  - Surface GPS as `{ latitude, longitude }` in decimal degrees ready for
 *    a maps deep-link.
 */

import exifr from 'exifr';

export interface ImageMetadata {
  /** Camera maker — e.g. "FUJIFILM", "Apple". */
  cameraMake?: string;
  /** Camera model — e.g. "X-T4", "iPhone 13 Pro". */
  cameraModel?: string;
  /** Lens model — e.g. "XF35mmF1.4 R". */
  lensModel?: string;

  /** Focal length in millimetres (e.g. 35). */
  focalLengthMm?: number;
  /** F-number / aperture (e.g. 1.4 → "f/1.4"). */
  aperture?: number;
  /** Shutter speed in seconds; render as fraction when < 1. */
  shutterSeconds?: number;
  /** ISO speed (e.g. 800). */
  iso?: number;
  /** Exposure bias in stops (e.g. -0.7). */
  exposureBiasEv?: number;
  /** Orientation as the standard EXIF integer (1..8). */
  orientation?: number;

  /** UTC capture moment as ms since epoch. */
  capturedAt?: number;

  /** GPS in decimal degrees, north + east positive. */
  latitude?: number;
  longitude?: number;
  altitudeMeters?: number;
}

const EXIFR_OPTIONS = {
  // Default `tiff: true` covers Make/Model; we add IPTC for caption-style
  // fields if they're ever present, and GPS for location. Skipping XMP +
  // ICC keeps the parse fast — they aren't surfaced in the Info tab.
  tiff: true,
  exif: true,
  gps: true,
  iptc: false,
  xmp: false,
  icc: false,
};

/** Parse EXIF / IPTC from a File or Blob. Returns null on failure or when
 *  every field of interest is missing — the Info tab then drops the whole
 *  Metadata section rather than rendering an empty card. */
export async function parseImageMetadata(file: File | Blob): Promise<ImageMetadata | null> {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = await exifr.parse(file, EXIFR_OPTIONS);
  } catch {
    return null;
  }
  if (!raw) return null;

  const out: ImageMetadata = {};

  // Strings — guard against weird whitespace / null chars some sources emit.
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  out.cameraMake  = str(raw.Make);
  out.cameraModel = str(raw.Model);
  out.lensModel   = str(raw.LensModel) ?? str(raw.LensInfo) ?? str(raw.Lens);

  // Numbers — exifr sometimes returns Fraction-like objects; coerce safely.
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const parsed = parseFloat(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  out.focalLengthMm = num(raw.FocalLength);
  out.aperture      = num(raw.FNumber) ?? num(raw.ApertureValue);
  out.shutterSeconds = num(raw.ExposureTime) ?? num(raw.ShutterSpeedValue);
  out.iso = num(raw.ISO) ?? num(raw.ISOSpeedRatings);
  out.exposureBiasEv = num(raw.ExposureBiasValue) ?? num(raw.ExposureCompensation);
  out.orientation = num(raw.Orientation);

  // exifr returns DateTimeOriginal as a JS Date when it can.
  const when = raw.DateTimeOriginal ?? raw.CreateDate ?? raw.DateTime;
  if (when instanceof Date && !Number.isNaN(when.getTime())) {
    out.capturedAt = when.getTime();
  }

  // GPS — exifr exposes parsed decimal `latitude` / `longitude` when present.
  out.latitude  = num(raw.latitude);
  out.longitude = num(raw.longitude);
  out.altitudeMeters = num(raw.GPSAltitude);

  // Drop the entire object when every field is empty — keeps the Info tab's
  // "only show what's available" promise without per-field checks at render.
  const hasAny = Object.values(out).some((v) => v !== undefined);
  return hasAny ? out : null;
}

// ─── Display helpers ───────────────────────────────────────────────────

/** "35 mm" — focal length, rounded to the nearest mm. */
export function formatFocalLength(mm: number | undefined): string | undefined {
  if (mm === undefined) return undefined;
  return `${Math.round(mm)} mm`;
}

/** "f/1.4" — aperture, one decimal place. */
export function formatAperture(f: number | undefined): string | undefined {
  if (f === undefined) return undefined;
  return `f/${f.toFixed(f < 10 ? 1 : 0)}`;
}

/** "1/250 s" for fast shutters, "2 s" for slow exposures. */
export function formatShutter(s: number | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s >= 1) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const denom = Math.round(1 / s);
  return `1/${denom} s`;
}

/** "ISO 800". */
export function formatIso(iso: number | undefined): string | undefined {
  if (iso === undefined) return undefined;
  return `ISO ${Math.round(iso)}`;
}

/** "+0.7 EV" / "-1.0 EV"; omits the field entirely at exactly 0. */
export function formatExposureBias(ev: number | undefined): string | undefined {
  if (ev === undefined || Math.abs(ev) < 0.01) return undefined;
  const sign = ev > 0 ? '+' : '−';
  return `${sign}${Math.abs(ev).toFixed(1)} EV`;
}

/** Locale-aware date/time. Falls back to ISO when Intl is unavailable. */
export function formatCapturedAt(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Decimal-degrees compass string ("48.137°N, 11.575°E"). */
export function formatCoordinates(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

/** Open-in-maps deep link (OpenStreetMap by default — no Google API key). */
export function mapsUrlFor(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`;
}

// ─── Document-level helpers (resolution, aspect, file size) ─────────────

/** Greatest common divisor — used to simplify aspect ratios. */
function _gcd(a: number, b: number): number {
  return b === 0 ? a : _gcd(b, a % b);
}

/** "3024 × 4032". Returns undefined when either dim is zero / missing. */
export function formatResolution(w: number | undefined, h: number | undefined): string | undefined {
  if (!w || !h) return undefined;
  return `${Math.round(w)} × ${Math.round(h)}`;
}

/** "3:2", "4:3", "16:9" — common ratios are simplified by GCD. Falls back
 *  to a decimal ratio for unusual dimensions. */
export function formatAspectRatio(w: number | undefined, h: number | undefined): string | undefined {
  if (!w || !h) return undefined;
  const g = _gcd(Math.round(w), Math.round(h));
  const a = Math.round(w) / g;
  const b = Math.round(h) / g;
  // Cap the displayed ratio at sensible whole numbers — when GCD doesn't
  // give us a clean small ratio, fall back to a decimal multiplier.
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  return (w >= h ? `${(w / h).toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`);
}

/** "12 MP". Megapixels rounded to one decimal under 10, integer above. */
export function formatMegapixels(w: number | undefined, h: number | undefined): string | undefined {
  if (!w || !h) return undefined;
  const mp = (w * h) / 1_000_000;
  return `${mp >= 10 ? Math.round(mp) : mp.toFixed(1)} MP`;
}

/** "JPEG", "HEIC", "PNG" — short tag derived from MIME or filename. */
export function formatFormatTag(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  const sub = mimeType.toLowerCase().split('/')[1] ?? '';
  if (!sub) return undefined;
  if (sub === 'jpeg' || sub === 'jpg') return 'JPEG';
  if (sub === 'heic' || sub === 'heif') return 'HEIC';
  // Everything else: uppercase + strip the `+xml` / `; charset=` tails.
  const clean = sub.replace(/[+;].*$/, '');
  return clean.toUpperCase();
}

/** "4.2 MB". Picks B / KB / MB / GB based on magnitude. */
export function formatFileSize(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const KB = bytes / 1024;
  if (KB < 1024) return `${KB.toFixed(KB < 10 ? 1 : 0)} KB`;
  const MB = KB / 1024;
  if (MB < 1024) return `${MB.toFixed(MB < 10 ? 1 : 0)} MB`;
  const GB = MB / 1024;
  return `${GB.toFixed(GB < 10 ? 1 : 0)} GB`;
}
