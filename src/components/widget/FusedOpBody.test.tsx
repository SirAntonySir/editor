/**
 * FusedOpBody — dispatch tests.
 *
 * Verifies that the rich body dispatcher correctly delegates to
 * HslWidgetBody / LevelsWidgetBody / CurvesWidgetBody when the op-slice
 * qualifies, and falls back to RegistryDrivenPanel (flat sliders) otherwise.
 *
 * Fixture shape mirrors makeHslWidget/makeAiWidget from __fixtures__/widgets so
 * the predicates isHslWidget / isFullLevelsWidget / isCurvesWidget pass.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Widget, ControlBinding } from '@/types/widget';
import type { OpSlice } from '@/lib/widget-slices';
import { makeHslWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import { FusedOpBody } from './FusedOpBody';
import { loadRegistry } from '@/lib/registry/loader';

afterEach(cleanup);
beforeEach(() => useEditorStore.setState({ hslRevealedBands: {} }));

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>(
    '@/store/backend-state-slice',
  );
  const buildState = () => ({
    sessionId: 's-1',
    optimistic: new Map(),
    snapshot: { masksIndex: [], revision: 1, widgets: [], operationGraph: { nodes: [] } },
    sseStatus: 'open',
    applyOptimistic: vi.fn(),
  });
  return {
    ...actual,
    useBackendState: Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (selector: (s: any) => any) => selector(buildState()),
      { getState: () => buildState() },
    ),
  };
});

const eff = (b: ControlBinding) => b.value;
const setParam = vi.fn();

// ─── HSL slice ───────────────────────────────────────────────────────────────

describe('FusedOpBody — HSL slice', () => {
  it('renders the HslWidgetBody band rail landmark', () => {
    // makeHslWidget(['blue']) → single-band widget with node type 'hsl'.
    // We treat the whole widget as both the parent and the slice content.
    const parent = makeHslWidget(['blue']);
    const opNode = parent.nodes[0];
    const reg = loadRegistry();
    const op = Object.values(reg.ops).find((o) => o.engine.node_type === 'hsl')!;
    expect(op).toBeTruthy();

    const slice: OpSlice = {
      op,
      bindings: parent.bindings,
      values: Object.fromEntries(parent.bindings.map((b) => [b.paramKey, b.value])),
      nodeId: opNode.id,
    };

    render(
      <FusedOpBody
        parentWidget={parent}
        slice={slice}
        effectiveValue={eff}
        setParam={setParam}
      />,
    );

    // HslWidgetBody (single-band mode) renders 3 sliders, not the "By band" tabs.
    expect(screen.queryByText('By band')).toBeNull();
    expect(screen.getAllByRole('slider').length).toBe(3);
  });

  it('renders the full band-rail panel for a multi-band HSL widget', () => {
    const parent = makeHslWidget(['red', 'blue']);
    // Make them both "edited" (non-default) so the multi-band view shows both.
    const editedParent: Widget = {
      ...parent,
      bindings: parent.bindings.map((b) => ({ ...b, value: 10 })),
    };
    const opNode = editedParent.nodes[0];
    const reg = loadRegistry();
    const op = Object.values(reg.ops).find((o) => o.engine.node_type === 'hsl')!;

    const slice: OpSlice = {
      op,
      bindings: editedParent.bindings,
      values: Object.fromEntries(editedParent.bindings.map((b) => [b.paramKey, b.value])),
      nodeId: opNode.id,
    };

    render(
      <FusedOpBody
        parentWidget={editedParent}
        slice={slice}
        effectiveValue={eff}
        setParam={setParam}
      />,
    );

    // Multi-band: HslPanelView shows "By band" / "By channel" tabs.
    expect(screen.getByText('By band')).toBeTruthy();
    expect(screen.getByText('By channel')).toBeTruthy();
  });
});

// ─── Levels slice ─────────────────────────────────────────────────────────────

describe('FusedOpBody — Levels slice', () => {
  function makeLevelsParent(): Widget {
    const nodeId = 'n-levels';
    const widgetId = 'w-levels-fused';
    const bindings: ControlBinding[] = [
      {
        paramKey: 'inBlack',
        label: 'Black',
        controlType: 'slider',
        target: { nodeId, paramKey: 'inBlack' },
        controlSchema: { controlType: 'slider', min: 0, max: 255, step: 1 },
        value: 0,
        default: 0,
      },
      {
        paramKey: 'inWhite',
        label: 'White',
        controlType: 'slider',
        target: { nodeId, paramKey: 'inWhite' },
        controlSchema: { controlType: 'slider', min: 0, max: 255, step: 1 },
        value: 255,
        default: 255,
      },
      {
        paramKey: 'gamma',
        label: 'Gamma',
        controlType: 'slider',
        target: { nodeId, paramKey: 'gamma' },
        controlSchema: { controlType: 'slider', min: 0.1, max: 3.0, step: 0.01 },
        value: 1.0,
        default: 1.0,
      },
    ];
    return {
      id: widgetId,
      intent: 'Levels',
      reasoning: undefined,
      scope: { kind: 'global' },
      origin: { kind: 'tool_invoked' },
      opId: 'levels',
      composed: true,
      nodes: [{
        id: nodeId,
        type: 'levels',
        scope: { kind: 'global' },
        inputs: [],
        widgetId,
        layerId: 'L1',
        params: { inBlack: 0, inWhite: 255, gamma: 1.0 },
      }],
      bindings,
      preview: { kind: 'none', autoBeforeAfter: false },
      rejectedAttempts: [],
      status: 'active',
      revision: 1,
      lockedParams: [],
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
    } as unknown as Widget;
  }

  it('renders the LevelsWidgetBody histogram landmark (Black point handle)', () => {
    const parent = makeLevelsParent();
    const reg = loadRegistry();
    const op = Object.values(reg.ops).find((o) => o.engine.node_type === 'levels')!;
    expect(op).toBeTruthy();

    const slice: OpSlice = {
      op,
      bindings: parent.bindings,
      values: { inBlack: 0, inWhite: 255, gamma: 1.0 },
      nodeId: parent.nodes[0].id,
    };

    render(
      <FusedOpBody
        parentWidget={parent}
        slice={slice}
        effectiveValue={eff}
        setParam={setParam}
      />,
    );

    // LevelsHistogramControl renders "Black point", "Gamma", "White point" buttons.
    expect(screen.getByLabelText('Black point')).toBeTruthy();
    expect(screen.getByLabelText('Gamma')).toBeTruthy();
    expect(screen.getByLabelText('White point')).toBeTruthy();
  });
});

// ─── Curves slice ─────────────────────────────────────────────────────────────

describe('FusedOpBody — Curves slice', () => {
  function makeSingleLumaCurvesParent(): Widget {
    const nodeId = 'n-curves';
    const widgetId = 'w-curves-fused';
    const bindings: ControlBinding[] = [
      {
        paramKey: 'points',
        label: 'Luma curve',
        controlType: 'curve',
        target: { nodeId, paramKey: 'points' },
        controlSchema: { controlType: 'curve' },
        value: [[0, 0], [255, 255]] as unknown as ControlBinding['value'],
        default: [[0, 0], [255, 255]] as unknown as ControlBinding['value'],
      },
    ];
    return {
      id: widgetId,
      intent: 'Tone curve',
      reasoning: undefined,
      scope: { kind: 'global' },
      origin: { kind: 'mcp_autonomous', anchor: { kind: 'global' } },
      opId: undefined,
      composed: true,
      nodes: [{
        id: nodeId,
        type: 'curves',
        scope: { kind: 'global' },
        inputs: [],
        widgetId,
        layerId: 'L1',
        params: { points: [[0, 0], [255, 255]] },
      }],
      bindings,
      preview: { kind: 'none', autoBeforeAfter: false },
      rejectedAttempts: [],
      status: 'active',
      revision: 1,
      lockedParams: [],
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
    } as unknown as Widget;
  }

  it('renders the CurvesWidgetBody curve editor SVG landmark', () => {
    const parent = makeSingleLumaCurvesParent();
    const reg = loadRegistry();
    // The curves op may be registered under a node_type 'curves'.
    // Fall back to a minimal stub op if absent so the test still exercises
    // dispatch (isCurvesWidget keys off bindings, not the op object).
    const op = Object.values(reg.ops).find((o) => o.engine.node_type === 'curves') ?? {
      id: 'curves',
      display_name: 'Curves',
      engine: { node_type: 'curves' },
      bindings: [],
      params: {},
      category: 'tone',
    };

    const slice: OpSlice = {
      op: op as import('@shared/registry/schema').RegistryOp,
      bindings: parent.bindings,
      values: { points: [[0, 0], [255, 255]] },
      nodeId: parent.nodes[0].id,
    };

    const { container } = render(
      <FusedOpBody
        parentWidget={parent}
        slice={slice}
        effectiveValue={eff}
        setParam={setParam}
      />,
    );

    // CurvesWidgetBody renders an <svg viewBox="0 0 200 200"> for the curve canvas.
    const svg = container.querySelector('svg[viewBox="0 0 200 200"]');
    expect(svg).not.toBeNull();
  });
});

// ─── Flat / plain-light slice ─────────────────────────────────────────────────

describe('FusedOpBody — flat fallback (light op)', () => {
  it('renders RegistryDrivenPanel (Exposure slider label) for a non-rich op', () => {
    const nodeId = 'n-basic';
    const widgetId = 'w-light-fused';
    const bindings: ControlBinding[] = [
      {
        paramKey: 'exposure',
        label: 'Exposure',
        controlType: 'slider',
        target: { nodeId, paramKey: 'exposure' },
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: 0,
        default: 0,
      },
    ];
    const parent: Widget = {
      id: widgetId,
      intent: 'Brighten sky',
      reasoning: undefined,
      scope: { kind: 'global' },
      origin: { kind: 'tool_invoked' },
      opId: 'light',
      composed: true,
      nodes: [{
        id: nodeId,
        type: 'basic',
        opId: 'light',
        scope: { kind: 'global' },
        inputs: [],
        widgetId,
        layerId: 'L1',
        params: { exposure: 0 },
      }],
      bindings,
      preview: { kind: 'none', autoBeforeAfter: false },
      rejectedAttempts: [],
      status: 'active',
      revision: 1,
      lockedParams: [],
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
    } as unknown as Widget;

    const reg = loadRegistry();
    const op = reg.ops['light'];
    expect(op).toBeTruthy();

    const slice: OpSlice = {
      op,
      bindings,
      values: { exposure: 0 },
      nodeId,
    };

    render(
      <FusedOpBody
        parentWidget={parent}
        slice={slice}
        effectiveValue={eff}
        setParam={setParam}
      />,
    );

    // RegistryDrivenPanel renders the param label "Exposure".
    expect(screen.getByText('Exposure')).toBeTruthy();
    // And an actual slider.
    expect(screen.getByRole('slider', { name: /exposure/i })).toBeTruthy();
  });
});
