import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SpawnPaletteWidget } from './SpawnPaletteWidget';

afterEach(cleanup);

describe('SpawnPaletteWidget', () => {
  it('renders nothing — replaced by inline AskAiInput in the right panel', () => {
    const { container } = render(<SpawnPaletteWidget />);
    expect(container.firstChild).toBeNull();
  });
});
