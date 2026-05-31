import { Plus } from 'lucide-react';
import { Kbd } from '@/components/ui/kbd';
import { useBackendState } from '@/store/backend-state-slice';

/** Floating command bar at the bottom-center of the canvas. Styled like a search
 *  input; clicking it (or pressing ⌘K) opens the command palette. Disabled when
 *  the backend is not connected. */
export function CommandTrigger() {
  const sseStatus = useBackendState((s) => s.sseStatus);
  const disabled = sseStatus !== 'open';

  return (
    <button
      type="button"
      aria-label="Open command palette"
      title="Open command palette (⌘K)"
      disabled={disabled}
      onClick={() => window.dispatchEvent(new CustomEvent('spawn-palette:open'))}
      className={`overlay absolute bottom-6 left-1/2 -translate-x-1/2 z-20
        flex items-center gap-2.5 h-9 min-w-[300px] pl-3 pr-2 text-xs
        transition-colors duration-150
        ${disabled
          ? 'opacity-40 cursor-not-allowed text-text-secondary'
          : 'text-text-secondary hover:text-text-primary cursor-text'}`}
    >
      <Plus size={15} className="shrink-0" />
      <span className="flex-1 text-left">Search tools or ask AI…</span>
      <Kbd keys={['mod', 'K']} />
    </button>
  );
}
