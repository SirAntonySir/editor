import { it, expect } from 'vitest';
import { sectionSummary } from './section-summary';
import type { ParamDefinition } from '@/types/processing';

const params: ParamDefinition[] = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, default: 0 },
];

it('all-default → em-dash summary, not dirty', () => {
  expect(sectionSummary(params, { exposure: 0, contrast: 0 })).toEqual({ summary: '—', dirty: false });
});

it('empty canonical params → all-default', () => {
  expect(sectionSummary(params, {})).toEqual({ summary: '—', dirty: false });
});

it('one non-default → labelled summary + dirty', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: 0 })).toEqual({ summary: 'Exposure +12', dirty: true });
});

it('multiple non-default → comma-joined, signed', () => {
  expect(sectionSummary(params, { exposure: 12, contrast: -10 })).toEqual({ summary: 'Exposure +12, Contrast −10', dirty: true });
});
