import { create } from 'zustand';
import { analyzeImage, createSession } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import { useEditorStore } from '@/store';
import { pixelStore } from '@/core/pixel-store';
import type { ImageContext } from '@/types/image-context';

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  uploadAndAnalyse: (source: ImageBitmap) => Promise<void>;
  restoreContext: (context: ImageContext) => void;
  reset: () => void;
}

export const useAiSession = create<AiSessionState>((set, get) => ({
  sessionId: null,
  context: null,
  status: 'idle',
  error: null,
  async uploadAndAnalyse(source) {
    set({ status: 'uploading', error: null, context: null, sessionId: null });
    try {
      const blob = await downscaleForUpload(source);
      const sessionId = await createSession(blob);
      set({ sessionId, status: 'analysing' });
      const context = await analyzeImage(sessionId);
      console.log('[ImageContext]', context);
      // Guard against the user loading another image while this resolves.
      if (get().sessionId !== sessionId) return;
      set({ context, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  /**
   * Restore a previously-cached context from disk (e.g. .edp open or session
   * restore). Sets status to 'ready' so the AI surface treats context as
   * available without re-invoking Claude. `sessionId` stays null until the
   * user explicitly re-uploads (via "Re-analyze image"), at which point
   * Cmd+K / refine become usable again.
   */
  restoreContext(context) {
    set({ context, status: 'ready', error: null });
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null });
  },
}));

/**
 * Kick off `uploadAndAnalyse` from the first image-type layer's source pixels.
 * Used after `.edp` open and after IndexedDB session-restore, both of which
 * hydrate the canvas without going through the fresh-file upload path.
 * No-op if there is no image layer, no source canvas, or a session is already
 * active.
 */
export async function analyseFirstImageLayer(): Promise<void> {
  if (useAiSession.getState().sessionId) return;
  const firstImage = useEditorStore.getState().layers.find((l) => l.type === 'image');
  if (!firstImage) return;
  const source = pixelStore.getSource(firstImage.id);
  if (!source) return;
  const bitmap = await createImageBitmap(source);
  await useAiSession.getState().uploadAndAnalyse(bitmap);
}
