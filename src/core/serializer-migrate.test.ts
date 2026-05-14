import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { migrateV1ToV2, type ManifestV1 } from './serializer-migrate';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '../../tests/fixtures');

function loadFixture(name: string): ManifestV1 {
  return JSON.parse(readFileSync(join(fixtures, name), 'utf-8'));
}

describe.each([
  'edp-v1-empty.json',
  'edp-v1-single-image.json',
  'edp-v1-with-text.json',
])('migrateV1ToV2(%s)', (fixture) => {
  it('produces a v2 manifest with a linear main branch and current=root', () => {
    const v1 = loadFixture(fixture);
    const v2 = migrateV1ToV2(v1, {
      layers: [],
      activeLayerId: v1.activeLayerId,
      pixelVersion: 0,
      graphPositions: {},
    });
    expect(v2.version).toBe(2);
    expect(v2.history).toBeDefined();
    expect(v2.history.rootId).toBe(v2.history.currentNodeId);
    expect(v2.history.branchHeads.main).toBe(v2.history.rootId);
    expect(v2.history.currentBranch).toBe('main');
    expect(v2.meta).toEqual(v1.meta);
    expect(v2.layers).toEqual(v1.layers);
    expect(v2.activeLayerId).toEqual(v1.activeLayerId);
    expect(v2.viewport).toEqual(v1.viewport);
  });
});
