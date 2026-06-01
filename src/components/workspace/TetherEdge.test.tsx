import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { TetherEdge } from './TetherEdge';

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
