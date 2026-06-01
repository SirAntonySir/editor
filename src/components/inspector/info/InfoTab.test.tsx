import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useBackendState } from '@/store/backend-state-slice';
import { InfoTab } from './InfoTab';
import { makeFullContext, makePartialContext } from './__fixtures__/enriched-context';
import type { SessionStateSnapshot } from '@/types/widget';

function setSnapshotWithContext(ctx: unknown) {
  const snap: SessionStateSnapshot = {
    session_id: 's1',
    image_context: ctx,
    widgets: [],
    masks_index: [],
    operation_graph: {
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

  it('shows the analysis-progress steps while analyzing (no context yet)', () => {
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
    // Overlay flips from CTA copy to "Analyzing image…" + the stepper phases.
    expect(screen.getByText('Analyzing image…')).not.toBeNull();
    expect(screen.getByText('Mechanical')).not.toBeNull();
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
    expect(screen.getByText('Regions')).not.toBeNull();
    expect(screen.getByText('Problems')).not.toBeNull();
    // dominant_tones rendered as chips (regression guard for the casing fix)
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
});
