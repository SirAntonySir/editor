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
  it('solid line for layer-scope', () => {
    const { container } = renderEdge('layer');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBeFalsy();
  });
  it('dashed line for node-scope', () => {
    const { container } = renderEdge('node');
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('3 3');
  });
});
