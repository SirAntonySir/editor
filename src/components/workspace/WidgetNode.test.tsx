import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { WidgetNode } from './WidgetNode';
import { makeAiWidget } from '@/components/widget/__fixtures__/widgets';
import { useEditorStore } from '@/store';
import type { WidgetNode as WNode } from '@/types/widget';

afterEach(cleanup);

const nodeTargeting = (layerId: string, layerIds?: string[]): WNode => ({
  id: 'n1', type: 'basic', scope: { kind: 'global' }, inputs: [],
  widgetId: 'w-conn', params: {}, layerId, ...(layerIds ? { layerIds } : {}),
});

const chromeVisibleMock = vi.fn(() => true);
vi.mock('@/hooks/useChromeVisible', () => ({
  useChromeVisible: () => chromeVisibleMock(),
}));

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  return {
    ...actual,
    useBackendState: Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (sel: (s: any) => any) => sel({ sessionId: 's-1', optimistic: new Map(), snapshot: { masksIndex: [], revision: 1 }, sseStatus: 'open' }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masksIndex: [], revision: 1 }, sseStatus: 'open' }) },
    ),
  };
});

describe('WidgetNode', () => {
  it('wraps a WidgetShell and renders the widget intent', () => {
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-ai-1" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(screen.getByText('Warm up shadows')).toBeInTheDocument();
  });
});

describe('WidgetNode tether handles', () => {
  it('mounts source handles on all four sides', () => {
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-1" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(document.querySelector('[data-handleid="tether-out-left"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-right"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-top"]')).toBeTruthy();
    expect(document.querySelector('[data-handleid="tether-out-bottom"]')).toBeTruthy();
  });

  // Regression: the break-out hub tether TARGETS the parent widget node.
  // React Flow's strict connection mode silently drops edges whose target
  // handle is a source-type handle, so widgets must expose real target
  // anchors (mirrors the image node's tether-in-* set).
  it('mounts target handles on all four sides for hub tethers', () => {
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-1" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const el = document.querySelector(`[data-handleid="tether-in-${side}"]`);
      expect(el).toBeTruthy();
      expect(el!.classList.contains('target')).toBe(true);
    }
  });
});

describe('WidgetNode tether handle anchoring', () => {
  it('leaves the outlets to React Flow (no inline anchor overrides)', () => {
    // Regression: the outlets used inline top/left (e.g. top:scaledH, left:scaledW)
    // that fought React Flow's per-position transforms and, more importantly, RF's
    // rule that an edge anchors to a handle's OUTER edge — pushing the tether a
    // full handle-size off the visible dot. RF's default positioning centres each
    // handle on its border; the dot is sized to fill the handle (see .tether-outlet
    // in index.css) so the edge plugs into the dot rim instead of floating past it.
    render(
      <ReactFlowProvider>
        <WidgetNode id="w-anchor" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const el = document.querySelector(`[data-handleid="tether-out-${side}"]`) as HTMLElement | null;
      expect(el, `tether-out-${side} should mount`).toBeTruthy();
      expect(el!.style.top, `${side} has no inline top`).toBe('');
      expect(el!.style.left, `${side} has no inline left`).toBe('');
      expect(el!.style.transform, `${side} has no inline transform`).toBe('');
    }
  });
});

describe('WidgetNode dimming follows the widget real target set', () => {
  afterEach(() => {
    useEditorStore.setState({ activeLayerId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  });

  it('does NOT dim a widget the user tethered later (target in layerIds, stale singular layerId)', () => {
    // The reported bug: a connected widget whose real target ('L-new') lives in
    // layerIds while the frozen singular layerId is the "legacy" sentinel.
    useEditorStore.setState({ activeLayerId: 'L-new' } as unknown as Parameters<typeof useEditorStore.setState>[0]);
    const widget = makeAiWidget({ nodes: [nodeTargeting('legacy', ['legacy', 'L-new'])] });
    const { container } = render(
      <ReactFlowProvider>
        <WidgetNode id="w-conn" data={{ widget }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('.opacity-40')).toBeNull();
  });

  it('dims a widget when the active layer is none of its targets', () => {
    useEditorStore.setState({ activeLayerId: 'L-other' } as unknown as Parameters<typeof useEditorStore.setState>[0]);
    const widget = makeAiWidget({ nodes: [nodeTargeting('legacy', ['legacy', 'L-new'])] });
    const { container } = render(
      <ReactFlowProvider>
        <WidgetNode id="w-conn" data={{ widget }} selected={false} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('.opacity-40')).not.toBeNull();
  });
});

describe('WidgetNode LOD behavior', () => {
  afterEach(() => {
    chromeVisibleMock.mockReturnValue(true); // reset
  });

  it('renders MarkerDot instead of WidgetShell when chromeVisible is false', () => {
    chromeVisibleMock.mockReturnValue(false);
    const { container } = render(
      <ReactFlowProvider>
        <WidgetNode id="w-lod" data={{ widget: makeAiWidget() }} selected={false} />
      </ReactFlowProvider>,
    );
    // MarkerDot SVG has aria-hidden and 16x16 dims.
    const dot = container.querySelector('svg[width="16"][height="16"]');
    expect(dot).not.toBeNull();
    // Widget intent should NOT render (no WidgetShell).
    expect(container.textContent).not.toContain('Warm up shadows');
  });
});
