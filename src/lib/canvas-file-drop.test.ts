import { describe, it, expect } from 'vitest';
import { isAcceptedImageFile, imageFilesFromList } from './canvas-file-drop';

function f(name: string, type = ''): File {
  return new File([new Uint8Array([0])], name, { type });
}

describe('isAcceptedImageFile', () => {
  it('accepts a web image by MIME type', () => {
    expect(isAcceptedImageFile(f('p.png', 'image/png'))).toBe(true);
  });

  it('accepts a web image by extension when MIME is empty', () => {
    expect(isAcceptedImageFile(f('photo.JPG', ''))).toBe(true);
  });

  it('accepts a camera RAW by extension (no image MIME)', () => {
    expect(isAcceptedImageFile(f('DSC01234.ARW', ''))).toBe(true);
  });

  it('rejects a non-image file', () => {
    expect(isAcceptedImageFile(f('notes.pdf', 'application/pdf'))).toBe(false);
  });

  it('rejects an extensionless typeless file', () => {
    expect(isAcceptedImageFile(f('README', ''))).toBe(false);
  });
});

describe('imageFilesFromList', () => {
  it('keeps only accepted image/RAW files, preserving order', () => {
    const list = [f('a.png', 'image/png'), f('b.pdf', 'application/pdf'), f('c.arw')];
    const out = imageFilesFromList(list);
    expect(out.map((x) => x.name)).toEqual(['a.png', 'c.arw']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(imageFilesFromList([f('x.txt', 'text/plain')])).toEqual([]);
  });
});
