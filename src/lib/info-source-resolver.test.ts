import { describe, it, expect } from 'vitest';
import { resolveSourceValue, type LiveSources } from './info-source-resolver';
import type { MechanicalSnapshot } from './mechanical-context';
import type { DocumentMeta } from '@/core/types';

function makeMech(p: Partial<MechanicalSnapshot> = {}): MechanicalSnapshot {
  return {
    lumaHistogram: new Array(256).fill(0),
    rgbHistograms: { r: new Array(256).fill(0), g: new Array(256).fill(0), b: new Array(256).fill(0) },
    clippedShadowsPct: 0.5,
    clippedHighlightsPct: 1.2,
    medianLuma: 127,
    contrastP10P90: 140,
    colorPalette: [],
    castStrength: 0.18,
    castDirection: [-4.8, -9.9],
    ...p,
  };
}

function makeDoc(p: Partial<DocumentMeta> = {}): DocumentMeta {
  return {
    id: 'd1', name: 'photo', createdAt: 0, modifiedAt: 0,
    width: 3024, height: 4032, mimeType: 'image/jpeg', fileSize: 4_200_000,
    ...p,
  };
}

const src = (mech: MechanicalSnapshot | null, documentMeta: DocumentMeta | null): LiveSources =>
  ({ mech, documentMeta });

describe('resolveSourceValue — mechanical sources', () => {
  it('returns formatted median + contrast + clipping when mech is present', () => {
    const live = src(makeMech(), null);
    expect(resolveSourceValue('mech:median_luma', live)).toBe('127');
    expect(resolveSourceValue('mech:contrast_p10_p90', live)).toBe('140');
    expect(resolveSourceValue('mech:clipped_shadows', live)).toBe('0.5%');
    expect(resolveSourceValue('mech:clipped_highlights', live)).toBe('1.2%');
    expect(resolveSourceValue('mech:cast_strength', live)).toBe('18%');
  });
  it('returns undefined when mech is null', () => {
    const live = src(null, makeDoc());
    expect(resolveSourceValue('mech:median_luma', live)).toBeUndefined();
  });
});

describe('resolveSourceValue — document sources', () => {
  it('resolves resolution + aspect + megapixels from documentMeta', () => {
    const live = src(null, makeDoc());
    expect(resolveSourceValue('doc:resolution', live)).toBe('3024 × 4032');
    expect(resolveSourceValue('doc:aspect',     live)).toBe('3:4');
    expect(resolveSourceValue('doc:megapixels', live)).toBe('12 MP');
  });
  it('resolves file format + size from documentMeta', () => {
    const live = src(null, makeDoc({ mimeType: 'image/heic', fileSize: 6_500_000 }));
    expect(resolveSourceValue('file:format', live)).toBe('HEIC');
    expect(resolveSourceValue('file:size', live)).toBe('6.2 MB');
  });
  it('returns undefined when documentMeta is null', () => {
    const live = src(null, null);
    expect(resolveSourceValue('doc:resolution', live)).toBeUndefined();
  });
});

describe('resolveSourceValue — EXIF sources', () => {
  it('resolves camera + lens from documentMeta.metadata', () => {
    const live = src(null, makeDoc({
      metadata: { cameraMake: 'FUJIFILM', cameraModel: 'X-T4', lensModel: 'XF35mmF1.4 R' },
    }));
    expect(resolveSourceValue('exif:camera', live)).toBe('FUJIFILM X-T4');
    expect(resolveSourceValue('exif:lens',   live)).toBe('XF35mmF1.4 R');
  });
  it('resolves capture params using image-metadata format helpers', () => {
    const live = src(null, makeDoc({
      metadata: {
        focalLengthMm: 35,
        aperture: 1.4,
        shutterSeconds: 1 / 250,
        iso: 800,
        exposureBiasEv: -0.7,
      },
    }));
    expect(resolveSourceValue('exif:focal',    live)).toBe('35 mm');
    expect(resolveSourceValue('exif:aperture', live)).toBe('f/1.4');
    expect(resolveSourceValue('exif:shutter',  live)).toBe('1/250 s');
    expect(resolveSourceValue('exif:iso',      live)).toBe('ISO 800');
    expect(resolveSourceValue('exif:bias',     live)).toBe('−0.7 EV');
  });
});

describe('resolveSourceValue — unknown source', () => {
  it('returns undefined so the caller falls back to the stored snapshot', () => {
    const live = src(makeMech(), makeDoc());
    expect(resolveSourceValue('mystery:thing', live)).toBeUndefined();
  });
});
