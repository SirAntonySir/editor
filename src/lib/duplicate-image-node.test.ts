/**
 * duplicate-image-node — name derivation only.
 *
 * The full duplicate flow round-trips OffscreenCanvas → blob → File →
 * addImage, which depends on a live document, pixelStore, and
 * IndexedDB; that's covered by integration paths. Here we just lock the
 * "copy" name semantics so the Layer-tab labels read cleanly across
 * repeated duplicates.
 */
import { describe, it, expect } from 'vitest';
import { deriveDuplicateName } from './duplicate-image-node';

describe('deriveDuplicateName', () => {
  it('inserts " copy" before the extension on the first duplicate', () => {
    expect(deriveDuplicateName('photo.jpg')).toBe('photo copy.jpg');
  });

  it('appends a counter on subsequent duplicates of an already-copied name', () => {
    expect(deriveDuplicateName('photo copy.jpg')).toBe('photo copy 2.jpg');
    expect(deriveDuplicateName('photo copy 2.jpg')).toBe('photo copy 3.jpg');
    expect(deriveDuplicateName('photo copy 9.jpg')).toBe('photo copy 10.jpg');
  });

  it('handles names without an extension', () => {
    expect(deriveDuplicateName('untitled')).toBe('untitled copy');
    expect(deriveDuplicateName('untitled copy')).toBe('untitled copy 2');
  });

  it('treats a leading dot as part of the stem (hidden file)', () => {
    // `.env` has no extension by the lastIndexOf rule (dot at index 0,
    // which the impl excludes via `dot > 0`). Behaves like a stem-only.
    expect(deriveDuplicateName('.env')).toBe('.env copy');
  });

  it('does not collide a literal " copy" anywhere mid-name with the counter', () => {
    // "my copy of last year.png" — the regex anchors to the END so the
    // mid-name "copy" stays as part of the stem.
    expect(deriveDuplicateName('my copy of last year.png'))
      .toBe('my copy of last year copy.png');
  });
});
