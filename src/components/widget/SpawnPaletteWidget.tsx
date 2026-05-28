import { useEffect, useRef, useState } from 'react';
import { proposeFromPalette } from '@/lib/palette-actions';
import { useSegmentSelection } from '@/store/segment-selection-slice';
import { maskStore } from '@/core/mask-store';

/** Floating spawn palette opened by ⌘K (via the 'spawn-palette:open' event
 *  dispatched by useSegmentInteraction). Auto-scopes from
 *  useSegmentSelection.selectedSegmentId. */
export function SpawnPaletteWidget() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedSegmentId = useSegmentSelection((s) => s.selectedSegmentId);

  useEffect(() => {
    const onOpen = () => { setOpen(true); setText(''); };
    window.addEventListener('spawn-palette:open', onOpen);
    return () => {
      window.removeEventListener('spawn-palette:open', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const scopeLabel = selectedSegmentId
    ? (maskStore.get(selectedSegmentId)?.label ?? 'segment')
    : 'global';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const scope = selectedSegmentId
        ? { kind: 'mask:click' as const, mask_id: selectedSegmentId }
        : { kind: 'global' as const };
      await proposeFromPalette(trimmed, scope);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] pointer-events-none">
      <form
        onSubmit={submit}
        className="glass-panel pointer-events-auto rounded-lg p-4 w-[480px] max-w-[90vw] flex flex-col gap-3 shadow-xl"
      >
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="px-2 py-0.5 bg-surface-secondary rounded text-text-primary">⌘K</span>
          <span>Ask Claude</span>
          <div className="flex-1" />
          <span>scope · {scopeLabel}</span>
        </div>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Claude to make a change…"
          rows={2}
          className="bg-surface-secondary border border-glass-border rounded p-2 text-sm text-text-primary outline-none resize-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs px-3 py-1 rounded bg-surface-secondary text-text-secondary"
          >Cancel</button>
          <button
            type="submit"
            disabled={busy || text.trim().length === 0}
            className="text-xs px-3 py-1 rounded bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >Send</button>
        </div>
      </form>
    </div>
  );
}
