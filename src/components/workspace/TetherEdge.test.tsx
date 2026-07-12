import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { TetherEdge } from './TetherEdge';
import type { TetherStrand } from '@/lib/tether-strands';

afterEach(cleanup);

function renderEdge(scopeKind: 'layer' | 'node') {
  return render(
    <ReactFlowProvider>
      <svg>
        <TetherEdge
          id="te-1" source="w" target="i" sourceX={100} sourceY={50} targetX={300} targetY={50}
          sourcePosition={Position.Right} targetPosition={Position.Left}
          data={{ scopeKind }}
        />
      </svg>
    </ReactFlowProvider>,
  );
}

describe('TetherEdge', () => {
  it('near-solid dash pattern for layer-scope, sums to 6 to match march cycle', () => {
    const { container } = renderEdge('layer');
    const path = container.querySelector('path');
    // Layer-scope: `5 1` — near-solid at rest, motion makes the dashes visible.
    // Sum must equal the marching-ants offset shift (see index.css) so the
    // CSS keyframe loops seamlessly.
    expect(path?.getAttribute('stroke-dasharray')).toBe('5 1');
    expect(path?.classList.contains('tether-march')).toBe(true);
  });
  it('half-half dash pattern for node-scope, sums to 6', () => {
    const { container } = renderEdge('node');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(path?.classList.contains('tether-march')).toBe(true);
  });
});

const defaultEdgeProps = {
  id: 'te-1',
  source: 'w',
  target: 'i',
  sourceX: 100,
  sourceY: 50,
  targetX: 300,
  targetY: 50,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  data: { scopeKind: 'layer' as const },
};

describe('TetherEdge canvas-space stroke', () => {
  it('renders stroke-width as a constant 1.5 (no chromeScale multiplier)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg><TetherEdge {...defaultEdgeProps} /></svg>
      </ReactFlowProvider>,
    );
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    // BaseEdge applies stroke-width via the style attribute on the path.
    const styleAttr = (path as SVGPathElement).getAttribute('style') ?? '';
    expect(styleAttr).toMatch(/stroke-width:\s*1\.5(\s|;|$)/);
  });

  it('renders endpoint dots with constant radius 3 (no chromeScale multiplier)', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg><TetherEdge {...defaultEdgeProps} /></svg>
      </ReactFlowProvider>,
    );
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
    for (const c of Array.from(circles)) {
      expect(c.getAttribute('r')).toBe('3');
    }
  });
});

function renderBraid(strands: TetherStrand[]) {
  return render(
    <ReactFlowProvider>
      <svg>
        <TetherEdge
          {...defaultEdgeProps}
          data={{ scopeKind: 'layer' as const, strands }}
        />
      </svg>
    </ReactFlowProvider>,
  );
}

describe('TetherEdge braided (fused) variant', () => {
  it('renders one strand path per op node, tinted by category token', () => {
    const { container } = renderBraid([
      { nodeId: 'n_a', opId: 'light', colorVar: 'var(--strand-tone)', separated: false },
      { nodeId: 'n_b', opId: 'color', colorVar: 'var(--strand-color)', separated: false },
      { nodeId: 'n_c', opId: 'blur', colorVar: 'var(--strand-detail)', separated: false },
    ]);
    const strandPaths = container.querySelectorAll('path[data-strand-node]');
    expect(strandPaths.length).toBe(3);
    expect(container.querySelector('path[data-strand-node="n_a"]')?.getAttribute('style')).toMatch(/var\(--strand-tone\)/);
    // Shared cable-end dots still present.
    expect(container.querySelectorAll('circle').length).toBe(2);
  });

  it('a separated strand lifts out: accent stroke, solid, apex dot present', () => {
    const { container } = renderBraid([
      { nodeId: 'n_a', opId: 'light', colorVar: 'var(--strand-tone)', separated: false },
      { nodeId: 'n_b', opId: 'color', colorVar: 'var(--strand-color)', separated: true },
    ]);
    const sep = container.querySelector('path[data-strand-separated="true"]');
    expect(sep).not.toBeNull();
    expect(sep?.getAttribute('data-strand-node')).toBe('n_b');
    // Separated strand is accent-blue (hand provenance) and solid (no ants).
    expect(sep?.getAttribute('style')).toMatch(/var\(--color-accent\)/);
    expect(sep?.getAttribute('stroke-dasharray')).toBeNull();
    expect(sep?.classList.contains('tether-march')).toBe(false);
    // Apex dot for the separated strand.
    expect(container.querySelector('circle[data-strand-apex="n_b"]')).not.toBeNull();
  });

  it('single-strand fused widget shows its tint with no weave and no apex dot', () => {
    const { container } = renderBraid([
      { nodeId: 'n_a', opId: 'grain', colorVar: 'var(--strand-texture)', separated: false },
    ]);
    const strandPaths = container.querySelectorAll('path[data-strand-node]');
    expect(strandPaths.length).toBe(1);
    expect(strandPaths[0].getAttribute('style')).toMatch(/var\(--strand-texture\)/);
    expect(container.querySelector('circle[data-strand-apex]')).toBeNull();
  });
});

describe('TetherEdge hub tint', () => {
  it('strokes the single hub path with the supplied strandColorVar', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <TetherEdge
            {...defaultEdgeProps}
            data={{ scopeKind: 'node' as const, variant: 'hub' as const, strandColorVar: 'var(--strand-detail)' }}
          />
        </svg>
      </ReactFlowProvider>,
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('style')).toMatch(/var\(--strand-detail\)/);
  });
});
