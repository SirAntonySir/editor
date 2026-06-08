import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CompiledReadout } from './CompiledReadout';

describe('CompiledReadout', () => {
  afterEach(cleanup);

  it('renders the top-N entries by absolute value', () => {
    render(
      <CompiledReadout
        entries={[
          { label: 'WB',         value: 3400, unit: 'K' },
          { label: 'Exposure',   value:  0.2 },
          { label: 'Vibrance',   value:  12 },
          { label: 'Orange Sat', value:  25 },
          { label: 'Shadow',     value:  -0.1 },
          { label: 'Tiny',       value:  0.001 },
        ]}
        topN={4}
      />,
    );
    // Highest |value| first: WB (3400), Orange Sat (25), Vibrance (12), Exposure (0.2).
    expect(screen.getByText('WB')).toBeTruthy();
    expect(screen.getByText('Orange Sat')).toBeTruthy();
    expect(screen.getByText('Vibrance')).toBeTruthy();
    expect(screen.getByText('Exposure')).toBeTruthy();
    expect(screen.queryByText('Tiny')).toBeNull();
    expect(screen.queryByText('Shadow')).toBeNull();
  });

  it('formats values with their unit when supplied', () => {
    render(<CompiledReadout entries={[{ label: 'WB', value: 3400, unit: 'K' }]} topN={1} />);
    expect(screen.getByText('3400K')).toBeTruthy();
  });

  it('renders an empty state hint when no entries pass the threshold', () => {
    render(<CompiledReadout entries={[{ label: 'A', value: 0 }]} topN={3} />);
    expect(screen.getByText(/no adjustments/i)).toBeTruthy();
  });
});
