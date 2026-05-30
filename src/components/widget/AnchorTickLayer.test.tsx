import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AnchorTickLayer } from './AnchorTickLayer';

afterEach(cleanup);

describe('AnchorTickLayer', () => {
  it('renders one tick per anchored widget at the supplied y', () => {
    render(
      <AnchorTickLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        positions={[
          { widgetId: 'w-1', x: 524, y: 149, isAnchored: true },
          { widgetId: 'w-2', x: 524, y: 124, isAnchored: false },
        ]}
      />,
    );
    const ticks = screen.getAllByLabelText(/anchor tick/i);
    expect(ticks).toHaveLength(1);
  });
});
