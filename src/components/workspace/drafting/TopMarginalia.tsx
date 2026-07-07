import { Eye, Lasso, MoreHorizontal, MousePointerClick, ScanSearch, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { track } from '@/lib/telemetry';
import { ScrollArea } from '@/components/ui/ScrollArea';

/**
 * The slice of a Radix menu namespace the shared `renderMenuItems` needs.
 * Both `DropdownMenu` and `ContextMenu` satisfy this structurally, so the
 * same item list can render in the `⋯` dropdown and the right-click menu —
 * including the nested "Export as…" submenu via Sub/SubTrigger/SubContent.
 */
export type MenuPrimitives = {
  Item: typeof DropdownMenu.Item;
  Sub: typeof DropdownMenu.Sub;
  SubTrigger: typeof DropdownMenu.SubTrigger;
  SubContent: typeof DropdownMenu.SubContent;
  Portal: typeof DropdownMenu.Portal;
};

interface TopMarginaliaProps {
  /** Image-node display name (file basename without extension). */
  title: string;

  /** Compare button — Eye icon. Per the spec the hold-to-show interaction
   *  doesn't fit a menu well, so it stays as a top-of-node affordance. */
  onCompareDown: () => void;
  onCompareUp: () => void;
  /** Objects-mode toggle — accent when active. Mirrors the ⋯ menu's
   *  Enter/Exit objects mode item, promoted to a header icon. */
  objectsActive?: boolean;
  onToggleObjectsMode?: () => void;
  /** Point-vs-lasso selection tool, shown only while objects mode is active.
   *  Point runs SAM on click; lasso draws a freehand polygon (no SAM). */
  objectSelectTool?: 'point' | 'lasso' | 'magic';
  onSelectObjectTool?: (tool: 'point' | 'lasso' | 'magic') => void;
  /** Analyze-with-AI header button (violet). Shown only when AI is available
   *  and the image hasn't been analysed yet — mirrors the menu item. */
  showAnalyze?: boolean;
  onAnalyze?: () => void;
  /** Items to render inside the `⋯` dropdown. The caller passes the same
   *  shared menu items the classic header uses, so Eye / Split / Merge /
   *  Delete all reach the user from one place. */
  renderMenuItems: (menu: MenuPrimitives) => ReactNode;
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
 * Drafting-mode replacement for the classic header strip. Carries the italic
 * Fraunces display title plus the Compare + ⋯ affordances. The active-layer
 * overline, format tag, and right-hand file-size column have been dropped —
 * the same data is already on display in BottomMarginalia, and duplicating it
 * in the header was reading as noise.
 */
export function TopMarginalia({
  title,
  onCompareDown,
  onCompareUp,
  objectsActive = false,
  onToggleObjectsMode,
  objectSelectTool = 'point',
  onSelectObjectTool,
  showAnalyze = false,
  onAnalyze,
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
      {/* Left column: display title */}
      <div className={`min-w-0 ${titleMaxW} flex flex-col`}>
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
            className={`font-[var(--font-display,Fraunces)] italic font-normal ${titleSize} leading-none -tracking-[0.015em] text-text-primary bg-transparent outline-none border-b border-[var(--color-accent)] w-full pr-[0.12em]`}
            aria-label="Rename image node"
          />
        ) : (
          <div
            // pr-[0.12em]: italic Fraunces' last glyph overshoots its advance
            // box; without this right inset `truncate`'s overflow:hidden clips
            // the final letter even when the name isn't actually truncated.
            className={`font-[var(--font-display,Fraunces)] italic font-normal ${titleSize} leading-none -tracking-[0.015em] text-text-primary truncate cursor-text pr-[0.12em]`}
            title={title}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onRenameStart?.();
            }}
          >
            {title}
          </div>
        )}
      </div>

      {/* Right column: control affordances */}
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1">
          {showAnalyze && onAnalyze && (
            <button
              type="button"
              aria-label="Analyze with AI"
              title="Analyze with AI"
              onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
              className="inline-flex items-center justify-center w-5 h-5 rounded-[3px] text-[var(--color-ai)] hover:bg-surface-secondary cursor-pointer"
            >
              <Sparkles size={12} aria-hidden />
            </button>
          )}
          {objectsActive && onSelectObjectTool && (
            <div
              role="radiogroup"
              aria-label="Object selection tool"
              className="inline-flex items-center rounded-[3px] bg-surface-secondary p-px mr-0.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={objectSelectTool === 'point'}
                aria-label="Point select (SAM)"
                title="Point select — click an object, SAM finds it"
                onClick={(e) => { e.stopPropagation(); onSelectObjectTool('point'); }}
                className={`inline-flex items-center justify-center w-5 h-5 rounded-[2px] cursor-pointer ${
                  objectSelectTool === 'point'
                    ? 'text-[var(--color-accent)] bg-surface-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <MousePointerClick size={12} aria-hidden />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={objectSelectTool === 'lasso'}
                aria-label="Lasso select (freehand)"
                title="Lasso select — draw a freehand region, no AI"
                onClick={(e) => { e.stopPropagation(); onSelectObjectTool('lasso'); }}
                className={`inline-flex items-center justify-center w-5 h-5 rounded-[2px] cursor-pointer ${
                  objectSelectTool === 'lasso'
                    ? 'text-[var(--color-accent)] bg-surface-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Lasso size={12} aria-hidden />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={objectSelectTool === 'magic'}
                aria-label="Magic lasso (snap to object)"
                title="Magic lasso — draw a rough loop, AI snaps to the object"
                onClick={(e) => { e.stopPropagation(); onSelectObjectTool('magic'); }}
                className={`inline-flex items-center justify-center w-5 h-5 rounded-[2px] cursor-pointer ${
                  objectSelectTool === 'magic'
                    ? 'text-[var(--color-accent)] bg-surface-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Wand2 size={12} aria-hidden />
              </button>
            </div>
          )}
          {onToggleObjectsMode && (
            <button
              type="button"
              aria-label={objectsActive ? 'Exit objects mode' : 'Enter objects mode'}
              title={objectsActive ? 'Exit objects mode' : 'Enter objects mode'}
              aria-pressed={objectsActive}
              onClick={(e) => { e.stopPropagation(); onToggleObjectsMode(); }}
              className={`inline-flex items-center justify-center w-5 h-5 rounded-[3px] hover:bg-surface-secondary cursor-pointer ${
                objectsActive
                  ? 'text-[var(--color-accent)] bg-surface-secondary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <ScanSearch size={12} aria-hidden />
            </button>
          )}
          <button
            ref={compareBtnRef}
            type="button"
            aria-label="Show original (hold)"
            onPointerDownCapture={(e) => {
              e.stopPropagation();
              track('compare.hold', { at: Date.now() });
              onCompareDown();
            }}
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
                className="overlay min-w-[160px] z-50"
                sideOffset={4}
                align="end"
              >
                <ScrollArea viewportClassName="p-1 max-h-[var(--radix-dropdown-menu-content-available-height)]">
                  {renderMenuItems({
                    Item: DropdownMenu.Item,
                    Sub: DropdownMenu.Sub,
                    SubTrigger: DropdownMenu.SubTrigger,
                    SubContent: DropdownMenu.SubContent,
                    Portal: DropdownMenu.Portal,
                  })}
                </ScrollArea>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}
