import { it, expect } from 'vitest';
import { sectionSummary } from './section-summary';
import type { ParamDefinition } from '@/types/processing';

const params: ParamDefinition[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
];

it('all-default → touchedCount 0, not dirty', () => {
  expect(sectionSummary(params, { exposure: 0, contrast: 0 })).toEqual({ touchedCount: 0, dirty: false });
});

it('empty canonical params → all-default', () => {
  expect(sectionSummary(params, {})).toEqual({ touchedCount: 0, dirty: false });
});

it('one non-default → touchedCount 1 + dirty', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: 0 })).toEqual({ touchedCount: 1, dirty: true });
});

it('multiple non-default → touchedCount matches', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: -10 })).toEqual({ touchedCount: 2, dirty: true });
});
