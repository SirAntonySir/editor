import { useState, useRef, useEffect } from 'react';

interface RefineInputProps {
  onSubmit: (instruction: string) => void;
  onCancel: () => void;
  pending: boolean;
}

export function RefineInput({ onSubmit, onCancel, pending }: RefineInputProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && text.trim()) onSubmit(text.trim());
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="flex items-center gap-1 px-1.5 py-1 border-t border-separator bg-surface-secondary">
      <input
        ref={ref}
        type="text"
        aria-label="Refine instruction"
        placeholder="e.g. stronger, add highlight recovery…"
        value={text}
        disabled={pending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        className="flex-1 bg-surface border border-separator rounded-[3px] text-[10px] px-1.5 py-0.5 outline-none focus:border-accent disabled:opacity-50"
      />
      <button
        onClick={() => text.trim() && onSubmit(text.trim())}
        disabled={pending || !text.trim()}
        className="text-[9px] bg-ai text-white border border-ai rounded-[3px] px-1.5 py-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send
      </button>
    </div>
  );
}
