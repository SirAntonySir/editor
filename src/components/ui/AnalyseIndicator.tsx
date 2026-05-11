import { Sparkles, Loader2, CircleX } from 'lucide-react';
import { useAiSession } from '@/hooks/useImageContext';

export function AnalyseIndicator() {
  const status = useAiSession((s) => s.status);
  const error = useAiSession((s) => s.error);

  if (status === 'idle') return null;

  const icon = (() => {
    if (status === 'uploading' || status === 'analysing') return <Loader2 className="h-3 w-3 animate-spin" />;
    if (status === 'ready') return <Sparkles className="h-3 w-3" />;
    return <CircleX className="h-3 w-3" />;
  })();

  const label = (() => {
    if (status === 'uploading') return 'Uploading image…';
    if (status === 'analysing') return 'Analysing image…';
    if (status === 'ready') return 'Image context ready';
    return error ?? 'Analysis failed';
  })();

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 glass-panel px-2 py-1 flex items-center gap-1 text-[11px] text-text-secondary">
      {icon}
      <span>{label}</span>
    </div>
  );
}
