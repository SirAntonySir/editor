import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
} from 'react';
import { triggerBeforeCaret, caretTokenToReplace, type PromptDoc } from '@/lib/prompt-doc';
import {
  CHIP_REMOVE_ATTR,
  CHIP_ROLE_TOGGLE_ATTR,
  CHIP_SOURCE_ATTR,
  flipChipRole,
  makeChipElement,
  parseEditorDom,
} from './prompt-editor-dom';

/** Imperative handle the palette uses to drive chip insertion + reset. */
export interface PromptEditorHandle {
  /** Insert a chip at the caret, replacing the in-progress word if any. Falls
   *  back to appending at the end when the editor isn't focused. */
  insertChipAtCaret(chip: { label: string; sourceId: string }): void;
  focus(): void;
  clear(): void;
}

export interface PromptEditorProps {
  /** Seed content rendered once on mount; the editor is uncontrolled after. */
  initialDoc?: PromptDoc;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Fires on every edit with the parsed doc. */
  onChange(doc: PromptDoc): void;
  /** Fires whenever the caret moves, with the filter query under the caret (the
   *  plain word, or the text after an `@`), a client rect for the caret (or
   *  null), and the trigger char (`'@'` for an explicit element mention, else
   *  `null`). */
  onCaretWordChange(query: string, caretRect: DOMRect | null, trigger: '@' | null): void;
}

// Submit (Enter) is intentionally NOT handled here. The palette's
// Dialog.Content keydown owns Enter so the region-picker can take precedence
// (accept-on-Enter) before a submit fires. Enter bubbles up and the ancestor
// preventDefaults the contenteditable newline.

const NBSP = ' ';

/** `contenteditable` prompt input that renders inline region chips. Owns all
 *  DOM/caret fiddliness so the palette can treat the prompt as a
 *  {@link PromptDoc}. Chips are atomic, non-editable spans.
 *
 *  Long prompts WRAP (capped, then vertical scroll) rather than scrolling
 *  horizontally — but the CONTENT stays single-line semantically: Enter
 *  submits (never inserts a newline; the palette's Dialog.Content owns it)
 *  and paste collapses newlines to spaces. */
export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(
    { initialDoc, placeholder, disabled, className, onChange, onCaretWordChange },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);

    // Render the seed doc once and autofocus (the palette opens straight into
    // typing). The editor is the source of truth afterward; React never
    // re-renders its children (that would fight the caret).
    useLayoutEffect(() => {
      const root = editorRef.current;
      if (!root) return;
      renderDocInto(root, initialDoc ?? []);
      if (!disabled) {
        root.focus();
        placeCaretAtEnd(root);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const emit = useCallback(() => {
      const root = editorRef.current;
      if (root) onChange(parseEditorDom(root));
    }, [onChange]);

    const reportCaret = useCallback(() => {
      const root = editorRef.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0 || !root.contains(sel.focusNode)) {
        onCaretWordChange('', null, null);
        return;
      }
      const node = sel.focusNode;
      const before =
        node && node.nodeType === Node.TEXT_NODE
          ? (node.textContent ?? '').slice(0, sel.focusOffset)
          : '';
      const { trigger, query } = triggerBeforeCaret(before);
      let rect: DOMRect | null = null;
      try {
        const r = sel.getRangeAt(0).cloneRange();
        r.collapse(true);
        const rects = r.getClientRects();
        const caretRect = rects.length ? rects[0] : r.getBoundingClientRect();
        // A collapsed range can return a zero/empty rect (e.g. at the end of a
        // text node in some engines). Fall back to anchoring under the editor's
        // bottom-left so the picker still appears in a sensible spot.
        rect =
          caretRect && (caretRect.width > 0 || caretRect.height > 0 || caretRect.top > 0)
            ? caretRect
            : root.getBoundingClientRect();
      } catch {
        rect = root.getBoundingClientRect();
      }
      onCaretWordChange(query, rect, trigger);
    }, [onCaretWordChange]);

    const insertChipAtCaret = useCallback(
      (chip: { label: string; sourceId: string }) => {
        const root = editorRef.current;
        if (!root) return;
        const chipEl = makeChipElement(chip);
        const space = document.createTextNode(NBSP);
        const sel = window.getSelection();

        if (sel && sel.rangeCount && root.contains(sel.focusNode)) {
          // Strip the in-progress word so "fix sho" → "fix [chip]".
          const node = sel.focusNode;
          if (node && node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent ?? '';
            const before = text.slice(0, sel.focusOffset);
            const word = caretTokenToReplace(before);
            if (word) {
              const keep = before.slice(0, before.length - word.length);
              node.textContent = keep + text.slice(sel.focusOffset);
              const range = document.createRange();
              range.setStart(node, keep.length);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
          const range = sel.getRangeAt(0);
          range.insertNode(space);
          range.insertNode(chipEl); // lands before `space` → chip, then space
          range.setStartAfter(space);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          root.appendChild(chipEl);
          root.appendChild(space);
          placeCaretAtEnd(root);
        }

        root.focus();
        emit();
        reportCaret();
      },
      [emit, reportCaret],
    );

    useImperativeHandle(
      ref,
      () => ({
        insertChipAtCaret,
        focus: () => {
          const root = editorRef.current;
          if (root) {
            root.focus();
            placeCaretAtEnd(root);
          }
        },
        clear: () => {
          const root = editorRef.current;
          if (root) root.replaceChildren();
          onChange([]);
          onCaretWordChange('', null, null);
        },
      }),
      [insertChipAtCaret, onChange, onCaretWordChange],
    );

    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>) => {
        // Backspace right after a chip deletes the whole chip atomically.
        if (e.key === 'Backspace') {
          const root = editorRef.current;
          const sel = window.getSelection();
          if (root && sel && sel.isCollapsed && sel.rangeCount && root.contains(sel.focusNode)) {
            const chip = chipBeforeCaret(root, sel.focusNode!, sel.focusOffset);
            if (chip) {
              e.preventDefault();
              chip.remove();
              emit();
              reportCaret();
            }
          }
        }
        // Everything else (Enter, arrows, Tab, Esc) bubbles to the palette's
        // Dialog.Content handler, which owns navigation + submit precedence.
      },
      [emit, reportCaret],
    );

    const handlePaste = useCallback(
      (e: ReactClipboardEvent<HTMLDivElement>) => {
        e.preventDefault();
        const raw = e.clipboardData?.getData('text/plain') ?? '';
        const text = raw.replace(/\s*\n\s*/g, ' '); // collapse newlines → single line
        insertTextAtCaret(editorRef.current, text);
        emit();
        reportCaret();
      },
      [emit, reportCaret],
    );

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        const removeBtn = target.closest(`[${CHIP_REMOVE_ATTR}]`);
        if (removeBtn) {
          const chip = removeBtn.closest(`[${CHIP_SOURCE_ATTR}]`);
          if (chip) {
            chip.remove();
            emit();
            reportCaret();
            return;
          }
        }
        const roleToggle = target.closest(`[${CHIP_ROLE_TOGGLE_ATTR}]`);
        if (roleToggle) {
          const chip = roleToggle.closest<HTMLElement>(`[${CHIP_SOURCE_ATTR}]`);
          if (chip) {
            flipChipRole(chip);
            emit();
            reportCaret();
            return;
          }
        }
        reportCaret();
      },
      [emit, reportCaret],
    );

    return (
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="false"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={() => {
          emit();
          reportCaret();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={reportCaret}
        onPaste={handlePaste}
        onClick={handleClick}
        // wrap + cap at ~6 lines (text-xs line-height 16px), then scroll
        // vertically. break-words so a pasted URL can't force a sideways
        // scroll back in.
        className={`prompt-editor flex-1 min-w-0 bg-transparent outline-none text-xs text-text-primary whitespace-pre-wrap break-words max-h-[96px] overflow-y-auto ${
          disabled ? 'opacity-60' : ''
        } ${className ?? ''}`}
      />
    );
  },
);

/** Build the editor's DOM children from a doc. */
function renderDocInto(root: HTMLElement, doc: PromptDoc): void {
  root.replaceChildren();
  for (const seg of doc) {
    if (seg.kind === 'text') root.appendChild(document.createTextNode(seg.text));
    else root.appendChild(makeChipElement(seg));
  }
}

/** Insert plain text at the caret (or append when unfocused). */
function insertTextAtCaret(root: HTMLElement | null, text: string): void {
  if (!root || !text) return;
  const sel = window.getSelection();
  if (sel && sel.rangeCount && root.contains(sel.focusNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tn = document.createTextNode(text);
    range.insertNode(tn);
    range.setStartAfter(tn);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    root.appendChild(document.createTextNode(text));
  }
}

/** Resolve the chip element immediately left of a collapsed caret, if any. */
function chipBeforeCaret(root: HTMLElement, node: Node, offset: number): HTMLElement | null {
  // Caret sits directly between the root's children.
  if (node === root) {
    const prev = root.childNodes[offset - 1];
    return isChip(prev) ? (prev as HTMLElement) : null;
  }
  // Caret at the very start of a text node → look at the previous sibling.
  if (node.nodeType === Node.TEXT_NODE && offset === 0) {
    let prev = node.previousSibling;
    while (prev && prev.nodeType === Node.TEXT_NODE && (prev.textContent ?? '') === '') {
      prev = prev.previousSibling;
    }
    return isChip(prev) ? (prev as HTMLElement) : null;
  }
  return null;
}

function isChip(node: Node | null): boolean {
  return (
    !!node &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).hasAttribute(CHIP_SOURCE_ATTR)
  );
}

function placeCaretAtEnd(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
