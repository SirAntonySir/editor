import { describe, it, expect } from 'vitest';
import {
  docToPlainText,
  wordBeforeCaret,
  serializePromptDoc,
  parseReferenceSourceId,
  parseAttachmentSourceId,
  toReferenceSourceId,
  toTargetSourceId,
  type PromptDoc,
} from './prompt-doc';

describe('reference vs target source ids', () => {
  it('parses a reference node/layer id', () => {
    expect(parseReferenceSourceId('reference:node:n1')).toEqual({ kind: 'node', id: 'n1' });
    expect(parseReferenceSourceId('reference:layer:l1')).toEqual({ kind: 'layer', id: 'l1' });
  });

  it('does not treat a target id as a reference (and vice versa)', () => {
    expect(parseReferenceSourceId('target:node:n1')).toBeNull();
  });

  it('parseAttachmentSourceId returns the role + ref', () => {
    expect(parseAttachmentSourceId('target:node:n1')).toEqual({ role: 'target', ref: { kind: 'node', id: 'n1' } });
    expect(parseAttachmentSourceId('reference:layer:l1')).toEqual({ role: 'reference', ref: { kind: 'layer', id: 'l1' } });
    expect(parseAttachmentSourceId('region:object:m1')).toBeNull();
  });

  it('flips a chip source id between roles preserving kind+id', () => {
    expect(toReferenceSourceId('target:node:n1')).toBe('reference:node:n1');
    expect(toTargetSourceId('reference:layer:l1')).toBe('target:layer:l1');
    // idempotent when already in the requested role
    expect(toReferenceSourceId('reference:node:n1')).toBe('reference:node:n1');
  });
});

describe('docToPlainText', () => {
  it('joins text segments verbatim', () => {
    const doc: PromptDoc = [{ kind: 'text', text: 'hello world' }];
    expect(docToPlainText(doc)).toBe('hello world');
  });

  it('renders a chip as its label inline', () => {
    const doc: PromptDoc = [
      { kind: 'text', text: 'separate the ' },
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
      { kind: 'text', text: ' and brighten them' },
    ];
    expect(docToPlainText(doc)).toBe('separate the shoes and brighten them');
  });
});

describe('wordBeforeCaret', () => {
  it('returns the trailing word token', () => {
    expect(wordBeforeCaret('separate the sho')).toBe('sho');
  });

  it('returns empty after a space', () => {
    expect(wordBeforeCaret('separate the ')).toBe('');
  });

  it('includes hyphens and digits but stops at spaces', () => {
    expect(wordBeforeCaret('use layer-2')).toBe('layer-2');
  });

  it('returns empty for empty input', () => {
    expect(wordBeforeCaret('')).toBe('');
  });
});

describe('serializePromptDoc', () => {
  it('builds intent with chip labels inline and trims', () => {
    const doc: PromptDoc = [
      { kind: 'text', text: '  separate the ' },
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
      { kind: 'text', text: '  ' },
    ];
    const { intent } = serializePromptDoc(doc);
    expect(intent).toBe('separate the shoes');
  });

  it('extracts object ids from object chips', () => {
    const doc: PromptDoc = [
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
    ];
    expect(serializePromptDoc(doc).attachedObjects).toEqual(['m1']);
  });

  it('extracts labels from ai-proposed region chips', () => {
    const doc: PromptDoc = [
      { kind: 'chip', label: 'Sky', sourceId: 'region:ai:sky' },
    ];
    expect(serializePromptDoc(doc).attachedObjects).toEqual(['sky']);
  });

  it('dedupes repeated chip ids', () => {
    const doc: PromptDoc = [
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
      { kind: 'text', text: ' and ' },
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
    ];
    expect(serializePromptDoc(doc).attachedObjects).toEqual(['m1']);
  });

  it('folds in tray chips after doc chips, deduped', () => {
    const doc: PromptDoc = [
      { kind: 'chip', label: 'shoes', sourceId: 'region:object:m1' },
    ];
    const tray = [{ sourceId: 'region:object:m2' }, { sourceId: 'region:object:m1' }];
    expect(serializePromptDoc(doc, tray).attachedObjects).toEqual(['m1', 'm2']);
  });

  it('ignores non-region chips', () => {
    const doc: PromptDoc = [
      { kind: 'chip', label: 'Untitled', sourceId: 'imageNode:abc' },
    ];
    expect(serializePromptDoc(doc).attachedObjects).toEqual([]);
  });

  it('returns deduped chip sourceIds, doc chips before tray chips', () => {
    const doc: PromptDoc = [
      { kind: 'text', text: 'brighten ' },
      { kind: 'chip', label: 'Sky', sourceId: 'region:ai:sky' },
      { kind: 'text', text: ' and ' },
      { kind: 'chip', label: 'Shoes', sourceId: 'region:object:m1' },
    ];
    const tray = [{ sourceId: 'region:object:m1' }, { sourceId: 'region:object:m2' }];
    const { chipSourceIds } = serializePromptDoc(doc, tray);
    expect(chipSourceIds).toEqual(['region:ai:sky', 'region:object:m1', 'region:object:m2']);
  });
});
