import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { useEditorStore } from '@/store';
import { analyseFirstImageLayer } from '@/hooks/useImageContext';

/**
 * Info-tab empty state: prompts the user to run the AI analysis that produces
 * image context. The action is gated the same way the toolrail is — it needs an
 * image layer and an open backend connection.
 */
export function NoContextState() {
  const hasImage = useEditorStore((s) => s.layers.some((l) => l.type === 'image'));
  const [busy, setBusy] = useState(false);

  // Enabled as soon as an image is loaded. Analysis BOOTSTRAPS the backend
  // session/SSE itself (analyseFirstImageLayer → uploadAndAnalyse), so we must
  // NOT gate on an already-open SSE — that left the button stuck disabled on a
  // freshly-loaded image (no session yet).
  const disabled = busy || !hasImage;
  const hint = !hasImage ? 'Open an image to analyze.' : null;

  async function run() {
    if (disabled) return;
    setBusy(true);
    try {
      await analyseFirstImageLayer();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Sparkles />
        </EmptyMedia>
        <EmptyTitle>No image context yet</EmptyTitle>
        <EmptyDescription>
          Run AI analysis to read this image — histograms, color, regions, and
          suggested adjustments.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <button
          type="button"
          onClick={run}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-button)] bg-accent px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Sparkles size={12} />
          {busy ? 'Analyzing…' : 'Analyze with AI'}
        </button>
        {hint && <span className="text-[10px] text-text-secondary">{hint}</span>}
      </EmptyContent>
    </Empty>
  );
}
