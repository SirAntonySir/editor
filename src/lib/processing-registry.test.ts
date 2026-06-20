/**
 * ProcessingRegistry — graceful skip-on-miss behavior.
 *
 * Phase 4 invariant: a missing registration must surface as a soft fallback,
 * never as a thrown error. The plan calls for new processing ops to register
 * via the registry; removing or failing to register one shouldn't break the
 * rest of the app.
 *
 * The registry is a module-level singleton, so each test resets the internal
 * map via re-import.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProcessingRegistry } from './processing-registry';
import type { ProcessingDefinition } from '@/types/processing';

const _resetRegistry = () => {
  // Reach into the private defs map by going through the public iteration
  // surface — there's no clear() in the public API, so re-register a
  // sentinel and rely on subsequent tests not depending on its absence.
  // Tests below only assert defensive misses; no setup is required.
};

describe('ProcessingRegistry — graceful skip-on-miss', () => {
  beforeEach(_resetRegistry);

  it('get() returns undefined for an unknown id', () => {
    expect(ProcessingRegistry.get('does-not-exist')).toBeUndefined();
  });

  it('has() returns false for an unknown id', () => {
    expect(ProcessingRegistry.has('does-not-exist')).toBe(false);
  });

  it('getByAdjustmentType() returns an empty array for an unknown type', () => {
    expect(ProcessingRegistry.getByAdjustmentType('unknown-type')).toEqual([]);
  });

  it('getNodeTypesForAdjustment() returns an empty array when no defs match', () => {
    expect(
      ProcessingRegistry.getNodeTypesForAdjustment({
        type: 'unknown-type',
        params: { x: 1 },
      }),
    ).toEqual([]);
  });

  it('filterParamsForDef() returns all params when the def is missing', () => {
    const allParams = { exposure: 0.5, contrast: 0.3 };
    expect(ProcessingRegistry.filterParamsForDef('missing-def', allParams)).toEqual(
      allParams,
    );
  });

  it('getParamRange() returns undefined when the def is missing', () => {
    expect(
      ProcessingRegistry.getParamRange('missing-def', 'exposure'),
    ).toBeUndefined();
  });

  it('getAdjustmentName() falls back to a capitalised type when no defs match', () => {
    expect(ProcessingRegistry.getAdjustmentName('vibrance')).toBe('Vibrance');
  });

  it('register() then get() returns the registered def', () => {
    const def = {
      id: 'test-def',
      label: 'Test Def',
      adjustmentType: 'test',
      category: 'light',
      paramKeys: ['k1'],
      params: [{ key: 'k1', range: [0, 1], default: 0, step: 0.01 } as never],
      Panel: () => null,
    } as unknown as ProcessingDefinition;
    ProcessingRegistry.register(def);
    expect(ProcessingRegistry.get('test-def')).toBe(def);
  });
});
