import { useEffect, useRef, useState } from 'react';
import { RotateCw, Repeat } from 'lucide-react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface LifecycleActionsProps {
  widget: Widget;
  isSuggestion: boolean;
  variant?: 'ai' | 'tool';
  onClose?: () => void;
}

export function LifecycleActions({ widget, isSuggestion, variant = 'ai', onClose }: LifecycleActionsProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (refining) inputRef.current?.focus();
  }, [refining]);

  async function run(fn: () => Promise<unknown>) {
    if (!sessionId) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  // Tool variant: no AI lifecycle — caller handles close via onClose.
  if (variant === 'tool') {
    return (
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          className="text-[10px] px-2 py-0.5 rounded bg-surface-secondary text-text-secondary hover:text-text-primary"
        >
          Close
        </button>
      </div>
    );
  }

  function submitRefine(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) { setRefining(false); return; }
    void run(async () => {
      await backendTools.refine_widget(sessionId!, {
        widget_id: widget.id, edits: [], additions: [], instruction: trimmed,
      });
      setInstruction('');
      setRefining(false);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {refining && (
        <form onSubmit={submitRefine} className="flex gap-1">
          <input
            ref={inputRef}
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setRefining(false); setInstruction(''); }
            }}
            onBlur={() => { if (!instruction.trim()) setRefining(false); }}
            placeholder="Refine…"
            className="flex-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-secondary border border-separator text-text-primary outline-none focus:border-accent"
            disabled={busy}
          />
        </form>
      )}

      {isSuggestion ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              console.log('[widget] accept clicked', widget.id);
              void run(() => backendTools.accept_widget(sessionId!, { widget_id: widget.id }));
            }}
            disabled={busy}
            className="flex-1 text-[10px] py-0.5 rounded bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ✓ Accept
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRefining((v) => !v);
            }}
            disabled={busy}
            className={
              'w-6 py-0.5 rounded text-[10px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ' +
              (refining ? 'bg-accent/20 text-accent' : 'bg-surface-secondary text-text-secondary hover:text-text-primary')
            }
            aria-label="Refine"
            title="Refine"
          >
            <RotateCw size={11} />
          </button>
        </div>
      ) : (
        <div className="flex gap-1 justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setRefining((v) => !v);
            }}
            disabled={busy}
            className={
              'w-6 py-0.5 rounded text-[10px] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ' +
              (refining ? 'bg-accent/20 text-accent' : 'bg-surface-secondary text-text-secondary hover:text-text-primary')
            }
            aria-label="Refine"
            title="Refine"
          >
            <RotateCw size={11} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              console.log('[widget] repeat clicked', widget.id);
              void run(() => backendTools.repeat_widget(sessionId!, { widget_id: widget.id }));
            }}
            disabled={busy}
            className="w-6 py-0.5 rounded text-[10px] flex items-center justify-center bg-surface-secondary text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Repeat"
            title="Repeat"
          >
            <Repeat size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
