import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { WidgetNode } from './WidgetNode';
import { makeAiWidget } from '@/components/widget/__fixtures__/widgets';

afterEach(cleanup);

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
      (sel: (s: any) => any) => sel({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open' }),
      { getState: () => ({ sessionId: 's-1', optimistic: new Map(), snapshot: { masks_index: [], revision: 1 }, sseStatus: 'open' }) },
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
