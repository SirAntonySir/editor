import { BACKEND_BASE_URL } from './backend-url';

/**
 * Camera-RAW handling on the frontend.
 *
 * Browsers can't decode camera RAW (`createImageBitmap` only handles
 * web-native formats), so a RAW file is shipped to the backend's
 * `/api/raw/develop` endpoint, which returns a JPEG preview we then feed into
 * the normal image-open path. Mirrors the backend extension list in
 * `app/services/raw_decode.py`.
 */
const RAW_EXTENSIONS = [
  '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.sr2', '.srf',
  '.raf', '.orf', '.rw2', '.pef', '.srw', '.raw', '.3fr', '.erf', '.kdc',
  '.mos', '.x3f', '.iiq', '.rwl',
];

/** `accept` fragment for file pickers — RAW isn't reliably covered by
 *  `image/*`, so the extensions are listed explicitly. */
export const RAW_ACCEPT = RAW_EXTENSIONS.join(',');

export function isRawFile(file: File): boolean {
  return RAW_EXTENSIONS.includes(extOf(file));
}

// Chromium has no TIFF decoder at all — createImageBitmap throws
// InvalidStateError on any .tif, so TIFF rides the same backend develop
// transport as RAW (and its 16-bit/float data survives into the PNG16).
const TIFF_EXTENSIONS = ['.tif', '.tiff'];

/** Does this file need the backend develop round-trip before the browser can
 *  decode it — camera RAW or TIFF (neither is web-native)? */
export function needsBackendDevelop(file: File): boolean {
  const ext = extOf(file);
  return RAW_EXTENSIONS.includes(ext) || TIFF_EXTENSIONS.includes(ext);
}

function extOf(file: File): string {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

/**
 * Develop a camera-RAW (or TIFF) File into a 16-bit PNG File via the backend.
 * The auth header (when configured) is attached automatically by the global
 * fetch wrapper (see backend-auth.ts). Throws on failure; the caller surfaces
 * a toast.
 */
export async function developRawFile(file: File): Promise<File> {
  // depth=16 → a 16-bit sRGB PNG. The open path decodes its high-bit data for
  // the float pipeline AND derives the 8-bit canvas (via createImageBitmap) for
  // every existing reader, so this stays compatible if the float path is off.
  const fd = new FormData();
  fd.append('image', file, file.name);
  const res = await fetch(`${BACKEND_BASE_URL}/api/raw/develop?depth=16`, { method: 'POST', body: fd });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`RAW develop failed: ${res.status} ${detail}`);
  }
  const blob = await res.blob();
  const pngName = `${file.name.replace(/\.[^.]+$/, '')}.png`;
  return new File([blob], pngName, { type: 'image/png' });
}
