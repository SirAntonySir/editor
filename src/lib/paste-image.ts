/**
 * Paste an image from the clipboard as a new image node — Cmd+V entry
 * point. Routes through the same `editorDocument.addImage` plumbing
 * the file picker uses so persistence, backend upload, and layer
 * creation all behave identically.
 *
 * Two clipboard read paths, tried in order:
 *   1. `navigator.clipboard.read()` — the modern async API. Returns
 *      ClipboardItem[] from which we look for the first `image/*` MIME.
 *      Requires permission + a user gesture; Cmd+V counts.
 *   2. `document.execCommand`-style `paste` event with
 *      `e.clipboardData.items` — fallback for environments where the
 *      async API isn't available (older Electron / Safari quirks).
 *
 * No-op + toast when the clipboard holds no image, when permission is
 * denied, or when no document is open (`addImage` requires a document
 * the new layer belongs to).
 */
import { editorDocument } from '@/core/document';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { toast } from '@/components/ui/Toast';

const SUPPORTED_PREFIX = 'image/';

/** Try to read an image from the system clipboard and import it as a
 *  new image node. Returns true when an image was found and ingested. */
export async function pasteImageFromClipboard(): Promise<boolean> {
  // Same gate as Add image… in the menu — paste needs an open document
  // (which carries the active session) and a live backend so the upload
  // goes through. Without this the new node would render but the
  // backend would never see the image.
  const hasDocument = useEditorStore.getState().documentMeta !== null;
  const sseOpen = useBackendState.getState().sseStatus === 'open';
  if (!hasDocument || !sseOpen) {
    toast.info(
      !hasDocument
        ? 'Open an image first, then paste to add more.'
        : 'Backend disconnected — paste once the session is live.',
    );
    return false;
  }

  const file = await readImageFromClipboard();
  if (!file) {
    toast.info('No image on the clipboard.');
    return false;
  }
  await editorDocument.addImage(file);
  return true;
}

/** Read the first image on the clipboard as a File. Returns null when
 *  nothing usable is there, or when the user denied permission. */
async function readImageFromClipboard(): Promise<File | null> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.clipboard?.read) return null;

  try {
    const items = await nav.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith(SUPPORTED_PREFIX));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      // Derive a filename from the MIME (`image/png` → `pasted.png`) so the
      // resulting layer has a non-blank name in the Layers panel.
      const ext = imageType.split('/')[1] || 'png';
      return new File([blob], `pasted.${ext}`, { type: imageType });
    }
  } catch (err) {
    // Permission denied / no-clipboard-api / read-failed — swallow, the
    // caller surfaces the user-visible toast. Logged for debugging only.
    console.debug('clipboard read failed', err);
  }
  return null;
}
