import { type ReactNode } from 'react';
import { RotateCcw, HelpCircle } from 'lucide-react';

interface WidgetShellFooterProps {
  onRefine: () => void;
  onWhy: () => void;
  onReset: () => void;
  onApply: () => void;
  applyDisabled: boolean;
  /** When provided, rendered in place of the built-in Why? button. */
  whyButton?: ReactNode;
  /** When false, hides the AI-only Refine and Why affordances. Defaults to true. */
  showAiAffordances?: boolean;
}

export function WidgetShellFooter({ onRefine, onWhy, onReset, onApply, applyDisabled, whyButton, showAiAffordances = true }: WidgetShellFooterProps) {
  return (
    <div className="flex items-center gap-px px-1.5 pt-1 pb-1.5 border-t border-separator">
      {showAiAffordances && (
        <>
          <button
            onClick={onRefine}
            className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
          >
            <RotateCcw size={10} aria-hidden /> Refine
          </button>
          {whyButton ?? (
            <button
              onClick={onWhy}
              className="inline-flex items-center gap-1 text-[9px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary px-1.5 py-0.5 rounded-[3px]"
            >
              <HelpCircle size={10} aria-hidden /> Why?
            </button>
          )}
        </>
      )}
      <span className="flex-1" />
      <button
        onClick={onReset}
        className="text-[10px] bg-surface text-text-primary border border-border-strong rounded-[4px] px-2 py-0.5 hover:bg-surface-secondary"
      >
        Reset
      </button>
      <button
        onClick={onApply}
        disabled={applyDisabled}
        className="text-[10px] bg-accent text-white border border-accent rounded-[4px] px-2 py-0.5 hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed ml-1"
      >
        Apply
      </button>
    </div>
  );
}
