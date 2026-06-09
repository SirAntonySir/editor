import { describe, it, expect } from 'vitest';
import { isCurvesWidget } from './CurvesWidgetBody';
import type { Widget } from '@/types/widget';

function makeWidget(bindings: Widget['bindings']): Widget {
  return {
    id: 'w1',
    intent: 'Test',
    status: 'active',
    bindings,
    // Cast through unknown — tests only exercise binding shape.
  } as unknown as Widget;
}

describe('isCurvesWidget', () => {
  it('detects the standard four-channel form (toolrail-spawned)', () => {
    const w = makeWidget(
      (['rgb', 'red', 'green', 'blue'] as const).map((ch) => ({
        param_key: ch,
        control_schema: { control_type: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      })) as unknown as Widget['bindings'],
    );
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('detects the single-luma form (AI fused tools — control_type=curve)', () => {
    const w = makeWidget([
      {
        param_key: 'points',
        control_schema: { control_type: 'curve' },
        value: [[0, 0], [255, 255]],
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('detects a single curve_editor binding as single-luma too', () => {
    const w = makeWidget([
      {
        param_key: 'luma',
        control_schema: { control_type: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('rejects widgets with no curve bindings', () => {
    const w = makeWidget([
      {
        param_key: 'exposure',
        control_schema: { control_type: 'slider', min: -1, max: 1, step: 0.01 },
        value: 0,
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(false);
  });

  it('rejects partial four-channel form (missing blue)', () => {
    const w = makeWidget(
      (['rgb', 'red', 'green'] as const).map((ch) => ({
        param_key: ch,
        control_schema: { control_type: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      })) as unknown as Widget['bindings'],
    );
    // Three curve bindings, not four, not one — fall through.
    expect(isCurvesWidget(w)).toBe(false);
  });
});
