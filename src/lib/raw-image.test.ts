import { describe, expect, it } from 'vitest';
import { isRawFile, needsBackendDevelop } from './raw-image';

const named = (name: string) => new File([new Uint8Array(4)], name);

describe('needsBackendDevelop', () => {
  it('routes camera RAW to the backend', () => {
    expect(needsBackendDevelop(named('shot.arw'))).toBe(true);
    expect(needsBackendDevelop(named('IMG.CR2'))).toBe(true);
  });

  it('routes TIFF to the backend — Chromium has no TIFF decoder', () => {
    expect(needsBackendDevelop(named('photo.tif'))).toBe(true);
    expect(needsBackendDevelop(named('photo.tiff'))).toBe(true);
    expect(needsBackendDevelop(named('SCAN.TIFF'))).toBe(true);
  });

  it('lets web-native formats pass through', () => {
    expect(needsBackendDevelop(named('photo.jpg'))).toBe(false);
    expect(needsBackendDevelop(named('photo.png'))).toBe(false);
    expect(needsBackendDevelop(named('noext'))).toBe(false);
  });
});

describe('isRawFile', () => {
  it('does not treat TIFF as camera RAW', () => {
    expect(isRawFile(named('photo.tif'))).toBe(false);
    expect(isRawFile(named('shot.arw'))).toBe(true);
  });
});
