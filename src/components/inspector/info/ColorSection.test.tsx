import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorSection } from './ColorSection';
import { makeFullContext } from './__fixtures__/enriched-context';

// ColorSection uses editorDocument and useEditorStore inside pinAt(); mock them
// so tests don't need a full store setup for basic dispatch assertions.
vi.mock('@/store', () => ({
  useEditorStore: Object.assign(
    vi.fn((selector: (s: { activeImageNodeId: null; imageNodes: Record<string, never> }) => unknown) =>
      selector({ activeImageNodeId: null, imageNodes: {} }),
    ),
    { getState: () => ({ activeImageNodeId: null, imageNodes: {} }) },
  ),
}));
vi.mock('@/core/document', () => ({
  editorDocument: { workspace: { addInfoNode: vi.fn() } },
}));
vi.mock('@/components/ui/Toast', () => ({ toast: { info: vi.fn() } }));
vi.mock('@/components/ui/ColorCastPlot', () => ({ ColorCastPlot: () => null }));
vi.mock('@/components/ui/Swatch', () => ({
  Swatch: ({ rgb }: { rgb: [number, number, number] }) => <span data-testid="swatch" style={{ color: `rgb(${rgb})` }} />,
}));

describe('ColorSection — swatch dispatch', () => {
  const originalDispatch = window.dispatchEvent.bind(window);
  const mockDispatch = vi.fn<typeof window.dispatchEvent>();

  beforeEach(() => {
    window.dispatchEvent = mockDispatch;
  });

  afterEach(() => {
    window.dispatchEvent = originalDispatch;
    mockDispatch.mockReset();
  });

  it('renders each palette swatch as a button', () => {
    const ctx = makeFullContext();
    render(<ColorSection ctx={ctx} />);
    // The fixture has 4 swatches; each becomes a <button aria-label="Color #...">
    const swatchBtns = screen.getAllByRole('button', { name: /^Color #/i });
    expect(swatchBtns.length).toBe(4);
  });

  it('clicking a palette swatch dispatches spawn-palette:open with Color label', async () => {
    const ctx = makeFullContext();
    render(<ColorSection ctx={ctx} />);
    const swatchBtns = screen.getAllByRole('button', { name: /^Color #/i });
    // Click the first swatch: rgb(20, 22, 30) => #14161e
    await userEvent.click(swatchBtns[0]);
    const paletteCall = mockDispatch.mock.calls.find(
      ([e]) => e instanceof CustomEvent && e.type === 'spawn-palette:open',
    );
    expect(paletteCall).toBeDefined();
    const event = paletteCall![0] as CustomEvent;
    const [item] = event.detail.attachContext as Array<{ label: string; value: string; sourceId: string }>;
    expect(item.label).toBe('Color');
    expect(item.value).toMatch(/#14161e/i);
    expect(item.sourceId).toMatch(/^color:#/i);
  });
});
