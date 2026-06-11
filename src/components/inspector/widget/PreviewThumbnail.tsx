import { startTransition, useEffect, useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface PreviewThumbnailProps {
  widget: Widget;
  maxDim?: number;
}

export function PreviewThumbnail({ widget, maxDim = 128 }: PreviewThumbnailProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!sessionId) return;
    // Reset loading state via startTransition to avoid the synchronous
    // set-state-in-effect pattern. The transition marks this as non-urgent
    // and prevents cascading-render warnings.
    startTransition(() => setLoading(true));
    (async () => {
      const env = await backendTools.preview_widget(sessionId, { widgetId: widget.id, max_dim: maxDim });
      if (cancelled) return;
      setImageB64(env.ok ? env.output!.image_b64 ?? null : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // Refetch when the widget revision bumps.
  }, [sessionId, widget.id, widget.revision, maxDim]);

  if (loading) return <div className="w-16 h-16 rounded bg-surface-secondary animate-pulse" />;
  if (!imageB64) {
    return (
      <div className="w-16 h-16 rounded bg-surface-secondary flex items-center justify-center text-[10px] text-text-secondary px-1 text-center">
        {widget.intent.slice(0, 24)}
      </div>
    );
  }
  return <img alt={widget.intent} src={`data:image/jpeg;base64,${imageB64}`} className="w-16 h-16 rounded object-cover" />;
}
