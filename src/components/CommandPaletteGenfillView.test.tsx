import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { CommandPaletteGenfillView } from './CommandPaletteGenfillView';

afterEach(() => cleanup());

describe('CommandPaletteGenfillView', () => {
  it('shows the attach-a-target hint when no region is resolved', () => {
    render(<CommandPaletteGenfillView hasRegion={false} draft="" />);
    expect(screen.getByText(/attach a target to fill/i)).toBeTruthy();
  });

  it('shows the generate instruction when a region is attached', () => {
    render(<CommandPaletteGenfillView hasRegion draft="a red boat" />);
    expect(screen.getByText(/to\s*generate/i)).toBeTruthy();
  });

  it('prompts for a description when the draft is empty but a region exists', () => {
    render(<CommandPaletteGenfillView hasRegion draft="" />);
    expect(screen.getByText(/describe what should appear/i)).toBeTruthy();
  });
});
