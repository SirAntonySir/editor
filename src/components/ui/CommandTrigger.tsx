import { Plus } from 'lucide-react';
import { useBackendState } from '@/store/backend-state-slice';

/** Discreet entry point that opens the command palette (mirrors ⌘K).
 *  Sits where the old toolrail lived. Disabled when the backend is not connected. */
export function CommandTrigger() {
  const sseStatus = useBackendState((s) => s.sseStatus);
  const disabled = sseStatus !== 'open';

  return (
    <div className="flex-none w-10 flex flex-col items-end justify-end py-2 px-1.5 bg-surface border-r border-separator">
      <button
        type="button"
        aria-label="Open command palette"
        title="Open command palette (⌘K)"
        disabled={disabled}
        onClick={() => window.dispatchEvent(new CustomEvent('spawn-palette:open'))}
        className={`flex items-center justify-center w-7 h-7 transition-colors duration-150
          ${disabled
            ? 'text-text-secondary opacity-30 cursor-not-allowed'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-secondary'}`}
        style={{ borderRadius: 'var(--radius-button)' }}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
