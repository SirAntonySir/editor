import { describe, it, expect } from 'vitest';
import { isCurvesWidget, resolveSingleCurvePoints } from './CurvesWidgetBody';
import type { ControlBinding, ControlValue, Widget } from '@/types/widget';

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
        paramKey: ch,
        controlSchema: { controlType: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      })) as unknown as Widget['bindings'],
    );
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('detects the single-luma form (AI fused tools — control_type=curve)', () => {
    const w = makeWidget([
      {
        paramKey: 'points',
        controlSchema: { controlType: 'curve' },
        value: [[0, 0], [255, 255]],
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('detects a single curve_editor binding as single-luma too', () => {
    const w = makeWidget([
      {
        paramKey: 'luma',
        controlSchema: { controlType: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(true);
  });

  it('rejects widgets with no curve bindings', () => {
    const w = makeWidget([
      {
        paramKey: 'exposure',
        controlSchema: { controlType: 'slider', min: -1, max: 1, step: 0.01 },
        value: 0,
      },
    ] as unknown as Widget['bindings']);
    expect(isCurvesWidget(w)).toBe(false);
  });

  it('rejects partial four-channel form (missing blue)', () => {
    const w = makeWidget(
      (['rgb', 'red', 'green'] as const).map((ch) => ({
        paramKey: ch,
        controlSchema: { controlType: 'curve_editor' },
        value: [[0, 0], [255, 255]],
      })) as unknown as Widget['bindings'],
    );
    // Three curve bindings, not four, not one — fall through.
    expect(isCurvesWidget(w)).toBe(false);
  });
});

describe('resolveSingleCurvePoints (AI single-luma form)', () => {
  // 0..255 space, matching the registry convention.
  const STALE = [[0, 0], [128, 100], [255, 255]];
  const LIVE = [[0, 0], [128, 200], [255, 255]];

  function fixture(nodePoints: unknown, bindingValue: unknown) {
    const b = {
      paramKey: 'points',
      controlSchema: { controlType: 'curve' },
      value: bindingValue,
      target: { nodeId: 'n1', paramKey: 'points' },
    } as unknown as ControlBinding;
    const w = {
      id: 'w1',
      bindings: [b],
      nodes: [{ id: 'n1', params: { points: nodePoints } }],
    } as unknown as Widget;
    return { w, b };
  }

  it('prefers the LIVE (optimistic) value over stale node params mid-drag', () => {
    // Node params carry the last backend echo; effectiveValue returns a
    // DIFFERENT object while an optimistic patch is in flight. If node params
    // won here, the editor's points snapped back to the stale curve on every
    // re-render and only caught up after the debounced backend round-trip —
    // the "AI curves widget lags" bug.
    const { w, b } = fixture(STALE, STALE);
    const pts = resolveSingleCurvePoints(w, b, LIVE as unknown as ControlValue);
    expect(pts[1].y).toBeCloseTo(200 / 255);
  });

  it('prefers node params when NO live edit is in flight', () => {
    // effectiveValue returns binding.value BY REFERENCE when no patch exists.
    // The binding value of fresh AI widgets can be a default-shaped
    // placeholder — the node's params are the real curve then.
    const placeholder = [[0, 0], [255, 255]];
    const { w, b } = fixture(STALE, placeholder);
    const pts = resolveSingleCurvePoints(w, b, b.value);
    expect(pts[1].y).toBeCloseTo(100 / 255);
  });
});
