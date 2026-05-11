import { create } from 'zustand';
import { analyzeImage, createSession } from '@/lib/ai-client';
import { downscaleForUpload } from '@/lib/downscale-for-upload';
import type { ImageContext } from '@/types/image-context';

interface AiSessionState {
  sessionId: string | null;
  context: ImageContext | null;
  status: 'idle' | 'uploading' | 'analysing' | 'ready' | 'error';
  error: string | null;
  uploadAndAnalyse: (source: ImageBitmap) => Promise<void>;
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
      // Guard against the user loading another image while this resolves.
      if (get().sessionId !== sessionId) return;
      set({ context, status: 'ready' });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },
  reset() {
    set({ sessionId: null, context: null, status: 'idle', error: null });
  },
}));
