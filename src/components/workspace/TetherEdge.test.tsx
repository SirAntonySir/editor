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
  it('near-solid dash pattern for layer-scope (marches via CSS animation)', () => {
    const { container } = renderEdge('layer');
    const path = container.querySelector('path');
    // Layer-scope uses a long dash + short gap so the marching-ants animation
    // is visible without the line looking obviously dashed at rest.
    expect(path?.getAttribute('stroke-dasharray')).toBe('5 2');
    expect(path?.classList.contains('tether-march')).toBe(true);
  });
  it('dashed line for node-scope', () => {
    const { container } = renderEdge('node');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('3 3');
    expect(path?.classList.contains('tether-march')).toBe(true);
  });
});
