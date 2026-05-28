import { useState } from 'react';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

interface LifecycleActionsProps {
  widget: Widget;
  isSuggestion: boolean;
}

export function LifecycleActions({ widget, isSuggestion }: LifecycleActionsProps) {
  const sessionId = useBackendState((s) => s.sessionId);
  const [refining, setRefining] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    if (!sessionId) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  if (isSuggestion) {
    return (
      <div className="flex gap-2">
        <button
          onClick={() => run(() => backendTools.accept_widget(sessionId!, { widget_id: widget.id }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-accent text-white"
        >Accept</button>
        <button
          onClick={() => run(() => backendTools.delete_widget(sessionId!, { widget_id: widget.id, suppress_similar: true }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Dismiss</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => setRefining((v) => !v)}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Refine</button>
        <button
          onClick={() => run(() => backendTools.repeat_widget(sessionId!, { widget_id: widget.id }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Repeat</button>
        <button
          onClick={() => run(() => backendTools.delete_widget(sessionId!, { widget_id: widget.id, suppress_similar: false }))}
          disabled={busy}
          className="text-xs px-2 py-1 rounded bg-surface-secondary"
        >Delete</button>
      </div>
      {refining && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = instruction.trim();
            if (!trimmed) return;
            void run(async () => {
              await backendTools.refine_widget(sessionId!, {
                widget_id: widget.id, edits: [], additions: [], instruction: trimmed,
              });
              setInstruction('');
              setRefining(false);
            });
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe a refinement…"
            className="flex-1 text-xs px-2 py-1 rounded bg-surface border border-glass-border"
          />
          <button type="submit" disabled={busy} className="text-xs px-2 py-1 rounded bg-accent text-white">
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
