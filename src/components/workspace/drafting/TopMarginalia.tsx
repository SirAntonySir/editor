import { Eye, MoreHorizontal } from 'lucide-react';
import { useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

interface TopMarginaliaProps {
  /** Image-node display name (file basename without extension). */
  title: string;
  /** Active layer's display name for the overline. */
  activeLayerName: string;
  /** Uppercase short tag — usually JPEG / PNG / RAW. Sits as a `<sup>`
   *  next to the italic title. */
  formatLabel: string;
  /** Optional meta line(s) for the right-aligned column. Each entry is a
   *  full line; rendered as Mono caps with `·` separators inside. */
  rhsLines?: string[];

  /** Compare button — Eye icon. Per the spec the hold-to-show interaction
   *  doesn't fit a menu well, so it stays as a top-of-node affordance. */
  onCompareDown: () => void;
  onCompareUp: () => void;
  /** Items to render inside the `⋯` dropdown. The caller passes the same
   *  shared menu items the classic header uses, so Eye / Split / Merge /
   *  Delete all reach the user from one place. */
  renderMenuItems: (Item: typeof DropdownMenu.Item) => ReactNode;
}

/**
 * Drafting-mode replacement for the classic header strip. Carries a
 * Geist-Mono overline with the active-layer label, an italic Fraunces
 * display title with a small superscript format tag, and an optional
 * monospaced meta column on the right. Compare + ⋯ menu are absolute-
 * positioned in the top-right slot so they don't disrupt the editorial
 * typography flow.
 */
export function TopMarginalia({
  title,
  activeLayerName,
  formatLabel,
  rhsLines,
  onCompareDown,
  onCompareUp,
  renderMenuItems,
}: TopMarginaliaProps) {
  const compareBtnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative mb-7 flex items-end justify-between gap-6">
      {/* Left column: overline + display title */}
      <div className="min-w-0 flex flex-col">
        <div className="font-[var(--font-mono)] text-[9px] tracking-[0.20em] uppercase text-text-secondary mb-1 flex items-center">
          <span
            aria-hidden
            className="inline-block w-[5px] h-[5px] rounded-full bg-[var(--color-accent)] mr-1.5 -translate-y-px"
          />
          Active layer · {activeLayerName}
        </div>
        <div className="font-[var(--font-display,Fraunces)] italic font-normal text-[34px] leading-none -tracking-[0.015em] text-text-primary truncate">
          {title}
          <sup className="font-[var(--font-mono)] text-[10px] not-italic tracking-[0.10em] uppercase text-text-secondary ml-2 align-super">
            {formatLabel}
          </sup>
        </div>
      </div>

      {/* Right column: optional meta lines + control affordances */}
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {rhsLines && rhsLines.length > 0 && (
          <div className="font-[var(--font-mono)] text-[10px] tracking-[0.16em] uppercase text-text-secondary text-right leading-[1.5]">
            {rhsLines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <button
            ref={compareBtnRef}
            type="button"
            aria-label="Show original (hold)"
            onPointerDownCapture={(e) => { e.stopPropagation(); onCompareDown(); }}
            onPointerUp={onCompareUp}
            onPointerLeave={onCompareUp}
            onPointerCancel={onCompareUp}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary cursor-pointer"
          >
            <Eye size={12} aria-hidden />
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Image node menu"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-5 h-5 rounded-[3px] text-text-secondary hover:text-text-primary hover:bg-surface-secondary cursor-pointer"
              >
                <MoreHorizontal size={12} aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="overlay p-1 min-w-[160px] z-50"
                sideOffset={4}
                align="end"
              >
                {renderMenuItems(DropdownMenu.Item)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}
