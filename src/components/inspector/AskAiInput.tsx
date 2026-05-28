import { useEffect, useRef, useState } from 'react';
import { proposeFromPalette } from '@/lib/palette-actions';
import { useEditorStore } from '@/store';
import type { Scope } from '@/types/widget';

export function AskAiInput() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('spawn-palette:open', onFocus);
    return () => window.removeEventListener('spawn-palette:open', onFocus);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const active = useEditorStore.getState().activeScope ?? { kind: 'global' as const };
      const sendScope: Scope = active.kind === 'mask'
        ? { kind: 'mask:click', mask_id: active.maskRef }
        : { kind: 'global' };
      await proposeFromPalette(trimmed, sendScope);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-1.5 bg-surface-secondary border border-glass-border
        rounded px-2 py-1 mb-1.5"
    >
      <span className="text-[9px] text-text-secondary">⌘</span>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask AI…"
        disabled={busy}
        className="flex-1 bg-transparent outline-none text-[10px] text-text-primary
          placeholder:text-text-secondary disabled:opacity-50"
      />
      <span className="text-[8px] text-text-secondary font-mono">⌘K</span>
    </form>
  );
}
