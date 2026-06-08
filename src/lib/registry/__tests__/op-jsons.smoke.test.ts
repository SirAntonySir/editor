import { describe, expect, it } from 'vitest';
import { RegistryOpSchema } from '../../../../shared/registry/schema';

// Glob all op JSONs.
const opModules = import.meta.glob('../../../../shared/registry/ops/*.json', {
  eager: true, import: 'default',
}) as Record<string, unknown>;

describe('op JSON files', () => {
  it('loads at least 12 op files', () => {
    expect(Object.keys(opModules).length).toBeGreaterThanOrEqual(12);
  });

  for (const [path, raw] of Object.entries(opModules)) {
    it(`validates ${path}`, () => {
      expect(() => RegistryOpSchema.parse(raw)).not.toThrow();
    });
  }
});
