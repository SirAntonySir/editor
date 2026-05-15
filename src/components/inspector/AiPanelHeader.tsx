import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import { RotateCcw, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/store';
import { refinePanel } from '@/lib/ai-client';
import { addRefinedAiPanelLayer, resetPanelToSuggestion } from '@/store/ai-panel-actions';
import { toast } from '@/components/ui/Toast';

interface AiPanelHeaderProps {
  layerId: string;
  /** Session ID from useImageContext. Null if no session is active. */
  sessionId: string | null;
}

export function AiPanelHeader({ layerId, sessionId }: AiPanelHeaderProps) {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === layerId));
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (refining) inputRef.current?.focus();
  }, [refining]);

  if (!layer || layer.type !== 'ai-panel') return null;
  const priorGraphId = layer.operationGraph?.id;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sessionId || !priorGraphId) {
      toast.error('Session unavailable. Re-open the image.');
      return;
    }
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const graph = await refinePanel(sessionId, priorGraphId, trimmed);
      addRefinedAiPanelLayer(layerId, graph);
      setInstruction('');
      setRefining(false);
    } catch (err) {
      toast.error('Refine failed. Try again.');
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setRefining(false);
      setInstruction('');
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] text-text-secondary">
      {refining ? (
        <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. more subtle, only the sky"
            maxLength={500}
            disabled={busy}
            className="flex-1 rounded bg-surface-secondary/60 px-2 py-1 text-text-primary outline-none placeholder:text-text-secondary/60"
          />
          <button
            type="submit"
            disabled={busy || !instruction.trim()}
            className="rounded bg-surface-secondary/60 px-2 py-1 text-text-primary disabled:opacity-50"
          >
            {busy ? '…' : 'Apply'}
          </button>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setRefining(true)}
            className="inline-flex items-center gap-1 rounded bg-surface-secondary/60 px-2 py-0.5 text-text-primary"
          >
            <Wand2 className="h-2.5 w-2.5" />
            <span>Refine…</span>
          </button>
          <button
            type="button"
            onClick={() => resetPanelToSuggestion(layerId)}
            title="Reset to model suggestion"
            className="inline-flex items-center gap-1 rounded bg-surface-secondary/60 px-2 py-0.5 text-text-primary"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            <span>Reset</span>
          </button>
        </>
      )}
    </div>
  );
}
