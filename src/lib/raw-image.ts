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
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot !== -1 && RAW_EXTENSIONS.includes(name.slice(dot));
}

/**
 * Develop a camera-RAW File into a JPEG File via the backend. The auth header
 * (when configured) is attached automatically by the global fetch wrapper
 * (see backend-auth.ts). Throws on failure; the caller surfaces a toast.
 */
export async function developRawFile(file: File): Promise<File> {
  const fd = new FormData();
  fd.append('image', file, file.name);
  const res = await fetch(`${BACKEND_BASE_URL}/api/raw/develop`, { method: 'POST', body: fd });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`RAW develop failed: ${res.status} ${detail}`);
  }
  const blob = await res.blob();
  const jpegName = `${file.name.replace(/\.[^.]+$/, '')}.jpg`;
  return new File([blob], jpegName, { type: 'image/jpeg' });
}
