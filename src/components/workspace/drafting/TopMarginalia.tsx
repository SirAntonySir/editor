import { Eye, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  /** Compact spacing — the row sits closer to the image. Without this, the
   *  marginalia float visibly above the canvas. */
  tight?: boolean;

  /**
   * Controlled rename: parent owns `isRenaming`, flipping it true (double-click
   * or menu) mounts an inline input seeded with the current title. Commit fires
   * `onRenameCommit(next)`; cancel fires `onRenameCancel()`.
   */
  isRenaming?: boolean;
  onRenameStart?: () => void;
  onRenameCommit?: (next: string) => void;
  onRenameCancel?: () => void;
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
  tight = false,
  isRenaming = false,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
}: TopMarginaliaProps) {
  const compareBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(title);
  const rowGap = tight ? 'mb-2' : 'mb-7';
  const overlineGap = tight ? 'mb-0.5' : 'mb-1';
  const titleSize = tight ? 'text-[24px]' : 'text-[34px]';
  // Cap the title column so long basenames don't push the meta column
  // off-screen or wrap; truncation kicks in past this.
  const titleMaxW = tight ? 'max-w-[280px]' : 'max-w-[420px]';

  // Seed the draft each time we enter rename mode and focus + select-all so
  // typing immediately replaces the existing name.
  useEffect(() => {
    if (!isRenaming) return;
    setDraft(title);
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [isRenaming, title]);

  function commit() {
    onRenameCommit?.(draft);
  }
  function cancel() {
    onRenameCancel?.();
  }

  return (
    <div className={`relative ${rowGap} flex items-end justify-between gap-6`}>
      {/* Left column: overline + display title */}
      <div className={`min-w-0 ${titleMaxW} flex flex-col`}>
        <div className={`font-[var(--font-mono)] text-[9px] tracking-[0.20em] uppercase text-text-secondary ${overlineGap} flex items-center`}>
          <span
            aria-hidden
            className="inline-block w-[5px] h-[5px] rounded-full bg-[var(--color-accent)] mr-1.5 -translate-y-px"
          />
          Active layer · {activeLayerName}
        </div>
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`font-[var(--font-display,Fraunces)] italic font-normal ${titleSize} leading-none -tracking-[0.015em] text-text-primary bg-transparent outline-none border-b border-[var(--color-accent)] w-full`}
            aria-label="Rename image node"
          />
        ) : (
          <div
            className={`font-[var(--font-display,Fraunces)] italic font-normal ${titleSize} leading-none -tracking-[0.015em] text-text-primary truncate cursor-text`}
            title={title}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onRenameStart?.();
            }}
          >
            {title}
            <sup className="font-[var(--font-mono)] text-[9px] not-italic tracking-[0.10em] uppercase text-text-secondary ml-2 align-super">
              {formatLabel}
            </sup>
          </div>
        )}
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
