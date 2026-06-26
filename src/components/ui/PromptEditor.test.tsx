import { createRef } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { PromptEditor, type PromptEditorHandle } from './PromptEditor';
import { CHIP_SOURCE_ATTR } from './prompt-editor-dom';
import type { PromptDoc } from '@/lib/prompt-doc';

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof PromptEditor>> = {}) {
  const ref = createRef<PromptEditorHandle>();
  const onChange = vi.fn();
  const onCaretWordChange = vi.fn();
  const utils = render(
    <PromptEditor
      ref={ref}
      onChange={onChange}
      onCaretWordChange={onCaretWordChange}
      {...overrides}
    />,
  );
  const editor = utils.container.querySelector('[contenteditable]') as HTMLElement;
  return { ref, onChange, onCaretWordChange, editor, ...utils };
}

function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection()!;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

it('renders the initial doc as text plus a chip element', () => {
  const initialDoc: PromptDoc = [
    { kind: 'text', text: 'separate the ' },
    { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
  ];
  const { editor } = setup({ initialDoc });
  expect(editor.textContent).toContain('separate the');
  const chip = editor.querySelector(`[${CHIP_SOURCE_ATTR}]`);
  expect(chip?.getAttribute(CHIP_SOURCE_ATTR)).toBe('region:object:m1');
});

it('emits a parsed doc on input', () => {
  const { editor, onChange } = setup();
  editor.textContent = 'hello';
  fireEvent.input(editor);
  expect(onChange).toHaveBeenLastCalledWith([{ kind: 'text', text: 'hello' }]);
});

it('reports the caret word on input', () => {
  const { editor, onCaretWordChange } = setup();
  editor.textContent = 'sho';
  placeCaret(editor.firstChild!, 3);
  fireEvent.input(editor);
  // jsdom has no layout, so the caret rect is null; the word is what matters.
  expect(onCaretWordChange.mock.calls.at(-1)![0]).toBe('sho');
});

it('insertChipAtCaret appends a chip when the editor is not focused', () => {
  const { ref, editor, onChange } = setup();
  ref.current!.insertChipAtCaret({ label: 'sky', sourceId: 'region:ai:sky' });
  expect(editor.querySelector(`[${CHIP_SOURCE_ATTR}]`)?.getAttribute(CHIP_SOURCE_ATTR)).toBe(
    'region:ai:sky',
  );
  const lastDoc = onChange.mock.calls.at(-1)![0] as PromptDoc;
  expect(lastDoc.some((s) => s.kind === 'chip' && s.sourceId === 'region:ai:sky')).toBe(true);
});

it('insertChipAtCaret replaces the caret word with the chip', () => {
  const { ref, editor, onChange } = setup();
  editor.textContent = 'fix sho';
  placeCaret(editor.firstChild!, 7);
  ref.current!.insertChipAtCaret({ label: 'shoes', sourceId: 'region:object:m1' });
  const lastDoc = onChange.mock.calls.at(-1)![0] as PromptDoc;
  // The "sho" fragment is gone; "fix " remains, followed by the chip.
  expect(lastDoc[0]).toEqual({ kind: 'text', text: 'fix ' });
  expect(lastDoc.some((s) => s.kind === 'chip' && s.sourceId === 'region:object:m1')).toBe(true);
  expect(lastDoc.some((s) => s.kind === 'text' && s.text.includes('sho'))).toBe(false);
});

it('clear empties the editor and emits an empty doc', () => {
  const { ref, editor, onChange } = setup({
    initialDoc: [{ kind: 'text', text: 'hello' }],
  });
  ref.current!.clear();
  expect(editor.textContent).toBe('');
  expect(onChange).toHaveBeenLastCalledWith([]);
});

it('deletes a whole chip on Backspace when the caret sits right after it', () => {
  const initialDoc: PromptDoc = [
    { kind: 'text', text: 'a ' },
    { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
  ];
  const { editor, onChange } = setup({ initialDoc });
  // Caret at end of the editor — immediately after the chip (last child).
  placeCaret(editor, editor.childNodes.length);
  fireEvent.keyDown(editor, { key: 'Backspace' });
  expect(editor.querySelector(`[${CHIP_SOURCE_ATTR}]`)).toBeNull();
  const lastDoc = onChange.mock.calls.at(-1)![0] as PromptDoc;
  expect(lastDoc.some((s) => s.kind === 'chip')).toBe(false);
});

it('coerces pasted content to single-line plain text', () => {
  const { editor, onChange } = setup();
  placeCaret(editor, 0);
  const data = { getData: (t: string) => (t === 'text/plain' ? 'a\nb' : '') };
  fireEvent.paste(editor, { clipboardData: data });
  const lastDoc = onChange.mock.calls.at(-1)![0] as PromptDoc;
  // Newline collapsed to a space → single-line "a b".
  expect(lastDoc).toEqual([{ kind: 'text', text: 'a b' }]);
});
