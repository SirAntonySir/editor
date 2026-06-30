import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { InfoTab } from './InfoTab';
import { makeFullContext, makePartialContext } from './__fixtures__/enriched-context';
import type { SessionStateSnapshot } from '@/types/widget';
import type { ImageContext } from '@/types/image-context';

function setSnapshotWithContext(ctx: ImageContext | null) {
  const snap: SessionStateSnapshot = {
    sessionId: 's1',
    imageContext: ctx,
    widgets: [],
    masksIndex: [],
    operationGraph: {
      id: 'g',
      userGoal: '',
      nodes: [],
      panelBindings: [],
      metadata: {},
    },
    revision: 1,
  };
  useBackendState.setState({ snapshot: snap });
}

describe('InfoTab', () => {
  beforeEach(() => {
    useBackendState.setState({ snapshot: null, phases: null, mcpAnalyzeComplete: false });
  });
  afterEach(cleanup);

  it('renders an empty state when no snapshot is present', () => {
    render(<InfoTab />);
    expect(screen.getByText('Analyze this image')).not.toBeNull();
  });

  it('offers an Analyze with AI action in the empty state', () => {
    render(<InfoTab />);
    expect(screen.getByRole('button', { name: /analyze with ai/i })).not.toBeNull();
  });

  it('keeps the overlay (with CTA in spinning state) while analyzing has no context yet', () => {
    useBackendState.setState({
      phases: {
        update: { status: 'done' },
        mechanical: { status: 'active' },
        sam_embed: { status: 'active' },
        ai_context: { status: 'pending' },
        mask_precompute: { status: 'pending' },
        widget_mint: { status: 'pending' },
      },
      mcpAnalyzeComplete: false,
    });
    render(<InfoTab />);
    // The hero copy stays put; the CTA flips to its in-flight "Analyzing…"
    // label. The stepper is intentionally gone — progress is communicated
    // by the skeletons flipping to real sections as deltas land.
    expect(screen.getByText('Analyze this image')).not.toBeNull();
    expect(screen.getByText('Analyzing…')).not.toBeNull();
  });

  it('renders an empty state when snapshot has no image_context', () => {
    setSnapshotWithContext(null);
    render(<InfoTab />);
    expect(screen.getByText('Analyze this image')).not.toBeNull();
  });

  it('renders all four sections for a complete context', () => {
    setSnapshotWithContext(makeFullContext());
    render(<InfoTab />);
    expect(screen.getByText('Semantic')).not.toBeNull();
    expect(screen.getByText('Histograms')).not.toBeNull();
    expect(screen.getByText('Color')).not.toBeNull();
    expect(screen.getByText('Elements')).not.toBeNull();
    expect(screen.getByText('Problems')).not.toBeNull();
    // dominantTones rendered as chips (regression guard for the casing fix)
    expect(screen.getByText('shadows')).not.toBeNull();
  });

  it('renders without crashing for a partial context (no problems, neutral grade)', () => {
    setSnapshotWithContext(makePartialContext());
    render(<InfoTab />);
    expect(screen.getByText('Semantic')).not.toBeNull();
    // Problems section header always renders once ctx is loaded — the body
    // says "No issues detected." when the problems array is empty.
    expect(screen.getByText('Problems')).not.toBeNull();
    expect(screen.getByText('No issues detected.')).not.toBeNull();
    expect(screen.queryByText('Grade')).toBeNull();
  });

  it('rerenders when activeImageNodeId changes (subscription guard)', () => {
    // No snapshot context — overlay is shown ("Analyze this image").
    render(<InfoTab />);
    expect(screen.getByText('Analyze this image')).not.toBeNull();

    // Switching the active image node should cause InfoTab to rerender.
    // In the test environment useLiveMechanicalContext resets its snapshot on
    // id change (it subscribes to activeImageNodeId); the explicit subscription
    // added in InfoTab is a defensive guard so the rerender is guaranteed even
    // if that transitive path were ever removed.
    act(() => {
      useEditorStore.setState({ activeImageNodeId: 'in-1' });
    });

    // Component still mounted and shows the overlay (no context in test env).
    expect(screen.getByText('Analyze this image')).not.toBeNull();

    // Switch to a different node — rerender triggered, still no crash.
    act(() => {
      useEditorStore.setState({ activeImageNodeId: 'in-2' });
    });

    expect(screen.getByText('Analyze this image')).not.toBeNull();
  });
});
