import { it, expect } from 'vitest';
import { parseEditorDom, makeChipElement, CHIP_SOURCE_ATTR } from './prompt-editor-dom';

function rootWith(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

it('parses plain text into a single text segment', () => {
  expect(parseEditorDom(rootWith('hello world'))).toEqual([
    { kind: 'text', text: 'hello world' },
  ]);
});

it('parses a chip span into a chip segment', () => {
  const root = document.createElement('div');
  root.appendChild(document.createTextNode('separate the '));
  root.appendChild(makeChipElement({ label: 'shoes', sourceId: 'region:object:m1' }));
  root.appendChild(document.createTextNode(' please'));
  expect(parseEditorDom(root)).toEqual([
    { kind: 'text', text: 'separate the ' },
    { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
    { kind: 'text', text: ' please' },
  ]);
});

it('merges adjacent text nodes and drops empty ones', () => {
  const root = document.createElement('div');
  root.appendChild(document.createTextNode('a'));
  root.appendChild(document.createTextNode(''));
  root.appendChild(document.createTextNode('b'));
  expect(parseEditorDom(root)).toEqual([{ kind: 'text', text: 'ab' }]);
});

it('returns an empty doc for an empty root', () => {
  expect(parseEditorDom(document.createElement('div'))).toEqual([]);
});

it('treats a stray <br> as no content', () => {
  expect(parseEditorDom(rootWith('<br>'))).toEqual([]);
});

it('makeChipElement carries the source id, label and is non-editable', () => {
  const chip = makeChipElement({ label: 'sky', sourceId: 'region:ai:sky' });
  expect(chip.getAttribute(CHIP_SOURCE_ATTR)).toBe('region:ai:sky');
  expect(chip.getAttribute('contenteditable')).toBe('false');
  expect(chip.textContent).toContain('sky');
});
